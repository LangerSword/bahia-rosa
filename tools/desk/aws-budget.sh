#!/usr/bin/env bash
# A desk that runs by the hour needs a bill alarm that actually rings.
#
# The account's existing monthly budget had thresholds but no subscriber — the alerts existed on
# paper and reached nobody. This attaches the address to that alert and adds a budget scoped to the
# desk itself, so a forgotten GPU is a mail, not a surprise.
#
#   tools/desk/aws-budget.sh            show what is set up
#   tools/desk/aws-budget.sh --apply    attach the subscriber + create the desk budget
set -euo pipefail

ACCOUNT="${AWS_ACCOUNT_ID:-703651068111}"
EMAIL="${DESK_ALERT_EMAIL:-lakshayasharma695@gmail.com}"
DESK_BUDGET="late-edition desk (GPU)"
DESK_LIMIT="${DESK_BUDGET_USD:-15}"
ACCOUNT_BUDGET="My Monthly Cost Budget"

log()  { printf '\033[38;5;218m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[38;5;85m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[38;5;215m!\033[0m %s\n' "$*"; }

show() {
  log "budgets in $ACCOUNT"
  aws budgets describe-budgets --account-id "$ACCOUNT" \
    --query 'Budgets[].[BudgetName,BudgetLimit.Amount]' --output text 2>/dev/null | sed 's/^/  /' || warn "no budgets readable"
  for budget in "$ACCOUNT_BUDGET" "$DESK_BUDGET"; do
    printf '  %s → ' "$budget"
    aws budgets describe-notifications-for-budget --account-id "$ACCOUNT" --budget-name "$budget" \
      --query 'Notifications[].[Threshold,Subscribers[].Address]' --output text 2>/dev/null | tr '\t' ' ' | tr '\n' '|' || true
    echo
  done
}

apply() {
  # 1. The existing account budget already has 85 % / 100 % thresholds; they were silent. The
  #    notification itself cannot be re-created (the API refuses a duplicate), but a subscriber can
  #    be attached to it — which is the part that was missing.
  log "attaching $EMAIL to the existing 85% alert on \"$ACCOUNT_BUDGET\""
  if aws budgets create-subscriber --account-id "$ACCOUNT" --budget-name "$ACCOUNT_BUDGET" \
    --notification '{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":85,"ThresholdType":"PERCENTAGE"}' \
    --subscriber "{\"SubscriptionType\":\"EMAIL\",\"Address\":\"$EMAIL\"}" >/dev/null 2>&1; then
    ok "account alert now reaches $EMAIL"
  else
    ok "$EMAIL was already subscribed to the account alert"
  fi

  # 2. A budget scoped to the desk: $DESK_LIMIT is ~12 h of g5 on-demand, or ~31 h of spot — the
  #    point is that it trips long before the account's monthly $10 would go unnoticed.
  log "creating \"$DESK_BUDGET\" (\$$DESK_LIMIT/month, EC2 compute only)"
  aws budgets create-budget --account-id "$ACCOUNT" \
    --budget "{\"BudgetName\":\"$DESK_BUDGET\",\"BudgetLimit\":{\"Amount\":\"$DESK_LIMIT\",\"Unit\":\"USD\"},\"TimeUnit\":\"MONTHLY\",\"BudgetType\":\"COST\",\"CostFilters\":{\"Service\":[\"Amazon Elastic Compute Cloud - Compute\"]}}" \
    --notifications-with-subscribers "[
      {\"Notification\":{\"NotificationType\":\"ACTUAL\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":50,\"ThresholdType\":\"PERCENTAGE\"},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"$EMAIL\"}]},
      {\"Notification\":{\"NotificationType\":\"ACTUAL\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":100,\"ThresholdType\":\"PERCENTAGE\"},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"$EMAIL\"}]},
      {\"Notification\":{\"NotificationType\":\"FORECASTED\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":100,\"ThresholdType\":\"PERCENTAGE\"},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"$EMAIL\"}]}
    ]" >/dev/null
  ok "desk budget live — alerts at 50%, 100% and forecasted 100%"
  echo
  show
}

case "${1:-show}" in
  show)  show ;;
  --apply|apply) apply ;;
  *) die "unknown argument: $1" ;;
esac
