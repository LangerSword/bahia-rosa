/**
 * The look compiler — turns src/look/look.json into the exact prompt the model receives.
 *
 * Why a compiler instead of a string in the script: the spec is data the whole project shares
 * (surfaces, palettes, lighting, compliance rules), and the prompt is one derived artefact. Every
 * plate is reproducible from spec version + register + overrides + seed.
 *
 * Plain ESM so the browser build, the unit tests, and the Node print desk all use this one file.
 */

/** @typedef {import('./look.json')} LookSpec */

export function pick(table, key, what) {
  const value = table?.[key];
  if (!value) {
    const known = Object.keys(table ?? {}).join(", ");
    throw new Error(`look spec: unknown ${what} "${key}" (known: ${known})`);
  }
  return value;
}

/** Hard compliance gate: the compiled prompt must never carry third-party or franchise terms. */
export function assertSafe(prompt, prohibited) {
  const haystack = prompt.toLowerCase();
  const hit = prohibited.find((term) => haystack.includes(term.toLowerCase()));
  if (hit) throw new Error(`look spec: compiled prompt contains prohibited term "${hit}"`);
  return prompt;
}

function identityClause(spec) {
  return `Subject: ${spec.identity.rules.join(" ")} Do not ${spec.identity.forbidden.join("; do not ")}.`;
}

function cameraClause(spec) {
  const c = spec.camera;
  const rim = c.rimLight ? ` ${c.rimLight}` : "";
  return `Camera: ${c.framing} ${c.lens} ${c.focus}${rim} Post: ${c.post}`;
}

function lightingClause(spec, key) {
  return `Lighting: ${pick(spec.lighting, key, "lighting preset")}`;
}

function paletteClause(spec, key) {
  const palette = pick(spec.palette, key, "palette");
  // Anchors are for humans and for the app's UI swatches; a 4B model reads words, not hex codes.
  const anchors = spec.render?.includePaletteAnchors ? ` Anchor colours: ${palette.anchors.join(", ")}.` : "";
  return `Palette: ${palette.description}${anchors}`;
}

/**
 * Compile a prompt.
 *
 * @param {object} spec - the parsed look.json
 * @param {object} [options]
 * @param {string} [options.register] - key in spec.registers (default: the loading surface's register)
 * @param {string} [options.surface] - surface id from spec.surfaces; supplies register + brief
 * @param {string} [options.location] - key in spec.locations; where the subject stands
 * @param {string} [options.lighting] - override the register's default lighting
 * @param {string} [options.palette] - override the register's default palette
 * @param {string} [options.brief] - the job's brief line (the per-surface instruction)
 * @param {number} [options.seed] - fixed seed; omit or -1 for a random one
 */
export function compile(spec, options = {}) {
  const surface = options.surface ? pick(spec.surfaces, options.surface, "surface") : null;
  const registerKey = options.register ?? surface?.register;
  const register = pick(spec.registers, registerKey, "register");
  // A location is where the subject is standing; it can also carry its own lighting and palette.
  const locationKey = options.location ? pick(spec.locations, options.location, "location") && options.location : null;
  const location = locationKey ? spec.locations[locationKey] : null;
  const lightingKey = options.lighting ?? location?.lighting ?? register.defaultLighting;
  const paletteKey = options.palette ?? location?.palette ?? register.defaultPalette;
  const brief = options.brief ?? surface?.brief ?? "";

  const clauses = {
    punch: spec.punch ?? "",
    medium: `Medium: ${register.medium}`,
    identity: identityClause(spec),
    scene: brief ? `Scene: ${brief}` : "",
    background: register.background ? `Background: ${register.background}` : "",
    scenery: location
      ? `Scenery: ${location.time ? `${location.time} — ` : ""}${location.scenery}`
      : `Scenery: ${spec.scenery}`,
    lighting: lightingClause(spec, lightingKey),
    palette: paletteClause(spec, paletteKey),
    camera: cameraClause(spec),
    finish: register.finish ? `Finish: ${register.finish}` : "",
    complianceTail: spec.compliance.promptTail,
  };

  const prompt = spec.promptOrder
    .map((key) => {
      const clause = clauses[key];
      if (clause === undefined) throw new Error(`look spec: promptOrder references unknown clause "${key}"`);
      return clause;
    })
    .filter(Boolean)
    .join(" ");

  assertSafe(prompt, spec.compliance.prohibited);

  const renderConfig = { ...spec.render, ...register.render };
  const seed = typeof options.seed === "number" && options.seed >= 0 ? options.seed : Math.floor(Math.random() * 2 ** 31);

  return {
    prompt,
    register: registerKey,
    location: locationKey,
    lighting: lightingKey,
    palette: paletteKey,
    seed,
    render: {
      width: renderConfig.width,
      height: renderConfig.height,
      steps: renderConfig.steps,
      guidance: options.guidance ?? renderConfig.guidance,
    },
    specVersion: spec.version,
  };
}

/** Compile for a named surface ("loading", "frontpage", …) — the app-facing entry point. */
export function compileForSurface(spec, surfaceId, options = {}) {
  return compile(spec, { ...options, surface: surfaceId });
}

/**
 * Filename that records provenance: every plate is traceable to spec + register + location + seed.
 * @param {{ register: string, seed: number, specVersion: string, location?: string | null }} parts
 */
export function plateFilename({ register, seed, specVersion, location }) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const where = location ? `-${location}` : "";
  return `${stamp}-${register}${where}-s${seed}-v${specVersion}.png`;
}
