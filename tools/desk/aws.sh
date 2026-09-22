#!/usr/bin/env bash
# Rent the desk instead of borrowing your own laptop.
#
# The tunnel (tools/desk/tunnel.sh) is free and is the right answer while this machine is awake. This
# script is for when it cannot be: a g5.xlarge in Mumbai — the one region where this account actually
# has GPU quota (4 vCPUs, exactly one instance) — that runs the same desk, publishes it through the
# same front door, and stops itself when nobody is printing.
#
#   tools/desk/aws.sh up            on-demand, $1.208/hr
#   tools/desk/aws.sh up --spot     spot, ~$0.48/hr (can be reclaimed by AWS mid-print)
#   tools/desk/aws.sh status        state, uptime, cost so far, and whether the desk answers
#   tools/desk/aws.sh url           the desk's public URL, straight off the instance
#   tools/desk/aws.sh logs          the instance's setup log
#   tools/desk/aws.sh down          stop it (disk and the 7 GB of weights survive) — $0/hr
#   tools/desk/aws.sh down --terminate   delete it for good
#
# Every command prints what it costs. There is no inbound port: the instance reaches out to
# Cloudflare, and you reach the instance through SSM, so nothing is exposed but the desk itself.
set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
ACCOUNT="${AWS_ACCOUNT_ID:-703651068111}"
NAME="late-edition-desk"
TYPE="${DESK_INSTANCE_TYPE:-g5.xlarge}"
ROLE="late-edition-desk-ssm"
PROFILE="late-edition-desk-ssm"
ONDEMAND_HOURLY="${DESK_ONDEMAND_HOURLY:-1.208}"
SPOT_HOURLY="${DESK_SPOT_HOURLY:-0.4757}"
IDLE_MINUTES="${DESK_IDLE_MINUTES:-20}"
REPO="${DESK_REPO:-https://github.com/LangerSword/late-edition.git}"

log()  { printf '\033[38;5;218m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[38;5;85m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[38;5;215m!\033[0m %s\n' "$*"; }
die()  { printf '\033[38;5;204m✗\033[0m %s\n' "$*" >&2; exit 1; }

instance_id() {
  aws ec2 describe-instances --region "$REGION" \
    --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[].Instances[].InstanceId' --output text 2>/dev/null | head -1
}

instance_state() {
  aws ec2 describe-instances --region "$REGION" --instance-ids "$1" \
    --query 'Reservations[].Instances[].State.Name' --output text 2>/dev/null | head -1
}

cost_note() { printf '  \033[38;5;215m$\033[0m %s\n' "$*"; }

user_data() {
  cat <<EOF
#!/bin/bash
set -euxo pipefail
exec >/var/log/desk-setup.log 2>&1

dnf install -y git nodejs npm jq
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="\$HOME/.local/bin:\$PATH"

# ComfyUI itself, then the desk's own repo.
git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git "\$HOME/comfy/ComfyUI"
git clone --depth 1 $REPO /opt/late-edition
cd /opt/late-edition

# The same setup the laptop runs: ComfyUI's venv + the desk's tools, the HF CLI, then the weights.
bash tools/desk/desk.sh setup
uv pip install --python "\$HOME/.venv/bin/python" "huggingface_hub[cli]"
bash tools/print-desk/fetch-models.sh --hq

# The desk and its front door — no app on a headless box.
bash tools/desk/desk.sh server

# Publish through the front door, exactly like the local desk.
bash tools/desk/tunnel.sh start

# Stop paying when nobody is printing. The front door touches the heartbeat on every print.
cat >/usr/local/bin/desk-idle-stop <<'WATCH'
#!/bin/bash
HB="\$HOME/.local/state/fifteen-minutes/last-print"
ID=\$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
ME=\$(curl -s -H "X-aws-ec2-metadata-token: \$ID" http://169.254.169.254/latest/meta-data/instance-id)
if [ -f "\$HB" ]; then LAST=\$(stat -c %Y "\$HB"); else LAST=\$(date +%s); fi
if [ \$(( \$(date +%s) - LAST )) -gt ${IDLE_MINUTES}600 ]; then
  logger "desk idle for ${IDLE_MINUTES}m — stopping \$ME"
  aws ec2 stop-instances --region $REGION --instance-ids "\$ME" || true
fi
WATCH
chmod +x /usr/local/bin/desk-idle-stop
echo "*/5 * * * * root /usr/local/bin/desk-idle-stop" >/etc/cron.d/desk-idle

echo "DESK READY \$(date -Is)" | tee /var/log/desk-ready
EOF
}

ensure_role() {
  if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
    log "creating the SSM role (so there is no inbound port to open)"
    aws iam create-role --role-name "$ROLE" \
      --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
    aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore >/dev/null
    aws iam put-role-policy --role-name "$ROLE" --policy-name desk-self-stop \
      --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["ec2:StopInstances"],"Resource":"*"}]}' >/dev/null
  fi
  if ! aws iam get-instance-profile --instance-profile-name "$PROFILE" >/dev/null 2>&1; then
    aws iam create-instance-profile --instance-profile-name "$PROFILE" >/dev/null
    aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE" --role-name "$ROLE" >/dev/null
    sleep 10
  fi
}

ensure_group() {
  local sg
  sg="$(aws ec2 describe-security-groups --region "$REGION" --filters "Name=group-name,Values=$NAME" \
    --query 'SecurityGroups[].GroupId' --output text 2>/dev/null | head -1)"
  if [[ -z "$sg" ]]; then
    sg="$(aws ec2 create-security-group --region "$REGION" --group-name "$NAME" \
      --description "late-edition desk: no inbound rules, the instance dials out" \
      --query GroupId --output text)"
    ok "security group $sg created with no inbound rules"
  fi
  echo "$sg"
}

ami_id() {
  # Deep Learning Base OSS Nvidia Driver GPU AMI: driver + CUDA already in place, which is the one
  # part of this that is genuinely annoying to install by hand.
  aws ec2 describe-images --region "$REGION" --owners amazon \
    --filters "Name=name,Values=Deep Learning Base OSS Nvidia Driver GPU AMI (Amazon Linux 2023)*" \
              "Name=state,Values=available" \
    --query 'reverse(sort_by(Images,&CreationDate))[0].ImageId' --output text
}

up() {
  local spot="false"
  [[ "${1:-}" == "--spot" ]] && spot="true"
  local existing; existing="$(instance_id)"
  if [[ -n "$existing" ]]; then
    local state; state="$(instance_state "$existing")"
    if [[ "$state" == "stopped" ]]; then
      log "restarting $existing (weights are on its disk, so it is serving in ~3 minutes)"
      aws ec2 start-instances --region "$REGION" --instance-ids "$existing" >/dev/null
      cost_note "$ONDEMAND_HOURLY/hr from now on — 'tools/desk/aws.sh down' when finished"
      return 0
    fi
    warn "$existing is already $state"; return 0
  fi

  ensure_role; local sg; sg="$(ensure_group)"; local ami; ami="$(ami_id)"
  [[ "$ami" == "None" ]] && die "no Deep Learning AMI found in $REGION"

  log "launching $TYPE in $REGION (ami $ami)"
  local args=(
    --region "$REGION" --image-id "$ami" --instance-type "$TYPE"
    --iam-instance-profile "Name=$PROFILE" --security-group-ids "$sg"
    --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=80,VolumeType=gp3,DeleteOnTermination=true}'
    --user-data "file:///tmp/desk-user-data.sh"
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]"
    --metadata-options 'HttpTokens=required'
  )
  if [[ "$spot" == "true" ]]; then
    args+=(--instance-market-options '{"MarketType":"spot","SpotOptions":{"SpotInstanceType":"one-time"}}')
    cost_note "spot ≈ \$$SPOT_HOURLY/hr — AWS may reclaim it mid-print"
  else
    cost_note "on-demand \$$ONDEMAND_HOURLY/hr — 'tools/desk/aws.sh down' stops the meter"
  fi

  user_data >/tmp/desk-user-data.sh
  # EC2 rejects non-ASCII in user-data (and says so as an XML error that names nothing useful), so the
  # script is squeezed to printable ASCII before it is handed over.
  tr -cd '\11\12\15\40-\176' </tmp/desk-user-data.sh >/tmp/desk-user-data.ascii
  mv /tmp/desk-user-data.ascii /tmp/desk-user-data.sh
  local id
  id="$(aws ec2 run-instances "${args[@]}" --query 'Instances[0].InstanceId' --output text)"
  ok "$id launched"
  log "first boot installs ComfyUI and pulls ~7 GB of weights — about 15 minutes."
  log "watch it:  tools/desk/aws.sh logs"
  log "then:      tools/desk/aws.sh url"
}

status() {
  local id; id="$(instance_id)"
  if [[ -z "$id" ]]; then warn "no desk instance in $REGION"; return 0; fi
  local state launched
  state="$(instance_state "$id")"
  launched="$(aws ec2 describe-instances --region "$REGION" --instance-ids "$id" \
    --query 'Reservations[].Instances[].LaunchTime' --output text)"
  ok "$id  $state  launched $launched"
  if [[ "$state" == "running" ]]; then
    local seconds
    seconds=$(( $(date +%s) - $(date -d "$launched" +%s) ))
    printf '  uptime %dh %dm  ·  burned ≈ $%s this session\n' $((seconds/3600)) $(((seconds%3600)/60)) \
      "$(awk -v s="$seconds" -v r="$ONDEMAND_HOURLY" 'BEGIN{printf "%.2f", s*r/3600}')"
    curl -s --max-time 5 "http://127.0.0.1:1/" >/dev/null 2>&1 || true
  else
    cost_note "stopped: the disk only, ≈ \$7.30/month for 80 GB"
  fi
  echo
  log "the desk's own view (through SSM):"
  ssm_run "cat /var/log/desk-ready 2>/dev/null || tail -3 /var/log/desk-setup.log" || true
}

ssm_run() {
  local id; id="$(instance_id)"
  [[ -z "$id" ]] && die "no instance"
  local cmd
  cmd="$(aws ssm send-command --region "$REGION" --instance-ids "$id" --document-name AWS-RunShellScript \
    --parameters "commands=[\"$1\"]" --query 'Command.CommandId' --output text)"
  for _ in $(seq 1 20); do
    sleep 3
    local out
    out="$(aws ssm get-command-invocation --region "$REGION" --command-id "$cmd" --instance-id "$id" \
      --query 'StandardOutputContent' --output text 2>/dev/null || true)"
    if [[ -n "$out" && "$out" != "None" ]]; then echo "$out"; return 0; fi
  done
  warn "no output yet — the instance may still be booting"
}

url() {
  log "asking the instance for its tunnel hostname"
  ssm_run "grep -oE 'https://[a-z0-9-]+\\.trycloudflare\\.com' \\\$HOME/.local/state/fifteen-minutes/tunnel.log | head -1"
  echo
  echo "  Point the deployed app at it:"
  echo "    https://langersword.github.io/late-edition/?desk=<that url>"
}

logs() { ssm_run "tail -40 /var/log/desk-setup.log"; }

down() {
  local id; id="$(instance_id)"
  [[ -z "$id" ]] && { warn "no instance to stop"; return 0; }
  if [[ "${1:-}" == "--terminate" ]]; then
    warn "terminating $id — the weights and the setup go with it"
    aws ec2 terminate-instances --region "$REGION" --instance-ids "$id" >/dev/null
    ok "terminated"
  else
    aws ec2 stop-instances --region "$REGION" --instance-ids "$id" >/dev/null
    ok "$id stopping — \$0/hr while stopped, \$7.30/month for its 80 GB disk (gp3 in Mumbai)"
    log "start it again with: tools/desk/aws.sh up   ·   or delete it: tools/desk/aws.sh down --terminate"
  fi
}

case "${1:-status}" in
  up)       up "${2:-}" ;;
  status)   status ;;
  url)      url ;;
  logs)     logs ;;
  down)     down "${2:-}" ;;
  *)        die "unknown argument: $1 — try up | status | url | logs | down [--terminate]" ;;
esac
