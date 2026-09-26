import { useCallback, useRef } from "react";
import ImageEditor, { type ImageEditorRef, type ImageEditorSaveResult } from "@unlayer/react-image-editor";

/**
 * The only place the Unlayer editor is mounted. Verified contract (docs/editor-contract.md):
 *  - props: image (URL | base64 data URL) · options · minHeight · onSave({dataUrl, blob}) · onCancel
 *           onLoadError() · onError(Error) · ref -> { editor }
 *  - instance: getImage() · hasChanges() · reset() · updateOptions() · destroy()
 *  - the editor script loads from cdn.unlayer.com, so the page needs internet
 *
 * Remount semantics: changing `image`, or any `options` key except theme/locale/translations,
 * destroys and recreates the editor. We therefore treat tool gating as an explicit remount
 * (`key={surfaceId}`) instead of patching options mid-session.
 */

export type ToolKey = "filter" | "crop" | "resize" | "draw" | "text" | "shapes" | "stickers" | "frame";
export type ToolGating = Partial<Record<ToolKey, boolean>>;

export interface EditorSurfaceProps {
  /** Stable id per surface — the remount key. */
  surfaceId: string;
  /** Portrait to edit: URL or base64 data URL. */
  image: string;
  gating: ToolGating;
  onSaved: (dataUrl: string, blob: Blob) => void;
  onCancelled?: () => void;
  onLoadFailed?: () => void;
}

/**
 * Tool gating payload. CONFIRMED against Unlayer's own demo app
 * (`demo/src/App.tsx` line 164 in unlayer/react-image-editor): the runtime takes
 * `features: { imageEditor: { dock, tools } }` where each tool maps to a boolean —
 * `true` keeps it, `false` removes it from the rail. (The docs also show an object form
 * with `icon`/`enabled` for overriding a tool's icon.)
 */
function buildTools(gating: ToolGating): Record<string, boolean> {
  return Object.fromEntries(Object.entries(gating).map(([tool, enabled]) => [tool, enabled === true]));
}

export function EditorSurface({ surfaceId, image, gating, onSaved, onCancelled, onLoadFailed }: EditorSurfaceProps) {
  const ref = useRef<ImageEditorRef>(null);

  const handleSave = useCallback(
    ({ dataUrl, blob }: ImageEditorSaveResult) => onSaved(dataUrl, blob),
    [onSaved],
  );

  /**
   * The city's typefaces, inside the editor's text tool.
   *
   * This is the one typed extension point the shipped package offers for the *look* of what a visitor writes
   * (`Fonts = { showDefaultFonts, customFonts }`, and `CustomFont` carries `label`, `value` and `url`), and
   * it is the difference between a poster that reads as ours and one that reads as someone's web form: the
   * headlines set in Limelight, the kickers in Poiret One, the script in Pinyon. The files are already
   * self-hosted for the rest of the site, so nothing is fetched from a font CDN.
   *
   * Absolute URLs, built from the page's own origin: the editor's runtime resolves them itself, and a
   * relative path would be resolved against whatever it considers its base.
   */
  const fontUrl = (file: string) => new URL(`/fonts/${file}`, window.location.origin).href;
  const options = {
    theme: "dark" as const,
    fonts: {
      showDefaultFonts: true,
      customFonts: [
        { label: "Limelight · the display face", value: "Limelight", url: fontUrl("Limelight-Regular.ttf") },
        { label: "Poiret One · the kicker", value: "Poiret One", url: fontUrl("PoiretOne-Regular.ttf") },
        { label: "Pinyon Script · the signature", value: "Pinyon Script", url: fontUrl("PinyonScript-Regular.ttf") },
        { label: "Italianno · the script", value: "Italianno", url: fontUrl("Italianno-Regular.ttf") },
        { label: "Inter · the body", value: "Inter", url: fontUrl("Inter[opsz,wght].ttf") },
      ],
    },
    // Cast: the shipped @unlayer/types declarations do not model every runtime-supported key
    // (see docs/editor-contract.md §"Typing gaps").
    features: { imageEditor: { tools: buildTools(gating) } },
  };

  return (
    // On a phone this is a desktop surface inside a scroller rather than a page that scrolls sideways: Unlayer's
    // editor is a 1024×700 contract (docs/editor-contract.md), and the arrangement above it is not, so the two
    // must not share a width. The wrapper takes the phone's width and lets the editor keep its own.
    <div className="editor-scroll">
      <div data-testid={`editor-surface-${surfaceId}`}>
        <ImageEditor
          key={surfaceId}
          ref={ref}
          image={image}
          minHeight="720px"
          options={options as never}
          onSave={handleSave}
          onCancel={() => onCancelled?.()}
          onLoadError={() => onLoadFailed?.()}
          onError={(error: Error) => console.error("Image Editor failed:", error)}
        />
      </div>
    </div>
  );
}
