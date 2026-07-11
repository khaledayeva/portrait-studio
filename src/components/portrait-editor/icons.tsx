import type { ReactNode, SVGProps } from "react";

export const PORTRAIT_EDITOR_ICON_NAMES = [
  "select-marquee",
  "hand",
  "brush",
  "eraser",
  "line",
  "rectangle",
  "ellipse",
  "fill-bucket",
  "eyedropper",
  "lasso",
  "undo",
  "redo",
  "eye-visible",
  "eye-hidden",
  "lock",
  "unlock",
  "plus",
  "duplicate",
  "arrow-up",
  "arrow-down",
  "trash",
  "import",
  "export",
  "play",
  "preview",
  "grid",
  "image",
  "reference",
  "zoom-in",
  "zoom-out",
  "chevron",
  "close",
  "check",
  "download",
  "upload",
  "move",
  "menu",
] as const;

export type PortraitEditorIconName = (typeof PORTRAIT_EDITOR_ICON_NAMES)[number];
export type ChevronDirection = "up" | "right" | "down" | "left";

export interface PortraitEditorIconProps
  extends Omit<SVGProps<SVGSVGElement>, "children"> {
  name: PortraitEditorIconName;
  size?: number | string;
  title?: string;
  direction?: ChevronDirection;
}

export type NamedIconProps = Omit<PortraitEditorIconProps, "name">;

type CoreIconName = Exclude<PortraitEditorIconName, "preview" | "reference">;

const iconGlyphs: Record<CoreIconName, ReactNode> = {
  "select-marquee": (
    <>
      <rect x="3.5" y="3.5" width="13" height="13" rx="1.5" strokeDasharray="2.5 2.5" />
      <path
        d="m13.2 12.5 7.2 6.7-3.5.6-1.5 2.7z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  hand: (
    <>
      <path d="M7.3 12V6.7a1.45 1.45 0 0 1 2.9 0V10" />
      <path d="M10.2 10V4.9a1.45 1.45 0 0 1 2.9 0V10" />
      <path d="M13.1 10V5.8a1.45 1.45 0 0 1 2.9 0V11" />
      <path d="M16 11V8.2a1.45 1.45 0 0 1 2.9 0v5.1c0 4.1-2.7 7.2-6.7 7.2h-1.3c-2.4 0-4-.9-5.2-2.8l-2.2-3.4a1.55 1.55 0 0 1 2.5-1.8l1.3 1.5" />
    </>
  ),
  brush: (
    <>
      <path d="m13.9 5.1 5 5" />
      <path d="M12.8 11.2 7.7 16.3" />
      <path d="m14.6 4.4 5 5a1.5 1.5 0 0 1 0 2.1l-6.3 6.3-7.1-7.1 6.3-6.3a1.5 1.5 0 0 1 2.1 0Z" />
      <path d="M7.7 16.3c-.8-.1-1.6.2-2 .9-.7 1.1-.5 2.5-2.4 3.4 2 .5 4.7.2 5.7-1.2.5-.7.5-1.6.1-2.3" />
    </>
  ),
  eraser: (
    <>
      <path d="m4.8 13.8 8.6-8.6a2 2 0 0 1 2.8 0l3.1 3.1a2 2 0 0 1 0 2.8l-8.6 8.6a2 2 0 0 1-2.8 0l-3.1-3.1a2 2 0 0 1 0-2.8Z" />
      <path d="m9.4 9.2 5.4 5.4" />
      <path d="M10.4 20h9.6" />
    </>
  ),
  line: (
    <>
      <path d="M5 19 19 5" />
      <circle cx="5" cy="19" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  rectangle: <rect x="4" y="5" width="16" height="14" rx="1.75" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.25" ry="6.25" />,
  "fill-bucket": (
    <>
      <path d="m4.2 12.4 7.9-7.9 7.3 7.3-7.9 7.9a2 2 0 0 1-2.8 0l-4.5-4.5a2 2 0 0 1 0-2.8Z" />
      <path d="m8.4 8.2 8.1 8.1" />
      <path d="M4.3 12.5h15.1" />
      <path d="M20.4 15.8s-2 2.3-2 3.5a2 2 0 0 0 4 0c0-1.2-2-3.5-2-3.5Z" />
    </>
  ),
  eyedropper: (
    <>
      <path d="m12.4 7.4 4.2 4.2-8.5 8.5a2 2 0 0 1-1.4.6H3.5v-3.2c0-.5.2-1 .6-1.4Z" />
      <path d="m14.7 4.3 1.2-1.2a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3l-1.2 1.2Z" />
      <path d="m12.4 7.4 4.2 4.2 3.1-3.1-4.2-4.2Z" />
      <path d="M3.5 20.7h4.6" />
    </>
  ),
  lasso: (
    <>
      <path d="M17.1 15.2c2.4-1.1 3.9-3 3.9-5.2 0-3.6-4-6.5-9-6.5S3 6.4 3 10s4 6.5 9 6.5c1.9 0 3.6-.4 5.1-1.3Z" />
      <path d="M17.1 15.2c-1.5.8-2.3 2.1-1.9 3.3.5 1.6 2.8 2.5 4.5 1.6 1.1-.6 1.4-1.8.7-2.7-.7-1-2.5-1-4.1.1" />
    </>
  ),
  undo: (
    <>
      <path d="m9 7-4.5 4.5L9 16" />
      <path d="M5 11.5h8.1c3.9 0 6.4 2 6.4 5.4 0 .9-.2 1.7-.5 2.4" />
    </>
  ),
  redo: (
    <>
      <path d="m15 7 4.5 4.5L15 16" />
      <path d="M19 11.5h-8.1c-3.9 0-6.4 2-6.4 5.4 0 .9.2 1.7.5 2.4" />
    </>
  ),
  "eye-visible": (
    <>
      <path d="M2.8 12s3.3-5.6 9.2-5.6 9.2 5.6 9.2 5.6-3.3 5.6-9.2 5.6S2.8 12 2.8 12Z" />
      <circle cx="12" cy="12" r="2.7" />
    </>
  ),
  "eye-hidden": (
    <>
      <path d="M9.3 6.8c.9-.3 1.8-.4 2.7-.4 5.9 0 9.2 5.6 9.2 5.6a14 14 0 0 1-2.2 2.8" />
      <path d="M6.2 8.3A14.6 14.6 0 0 0 2.8 12s3.3 5.6 9.2 5.6c1.2 0 2.3-.2 3.3-.6" />
      <path d="M10.2 10.1a2.7 2.7 0 0 0 3.7 3.7" />
      <path d="m3.5 3.5 17 17" />
    </>
  ),
  lock: (
    <>
      <rect x="5.5" y="10" width="13" height="10.5" rx="2" />
      <path d="M8.2 10V7.3a3.8 3.8 0 0 1 7.6 0V10" />
      <path d="M12 14.1v2.4" />
    </>
  ),
  unlock: (
    <>
      <rect x="5.5" y="10" width="13" height="10.5" rx="2" />
      <path d="M15.8 10V7.3a3.8 3.8 0 0 0-7.2-1.7" />
      <path d="M12 14.1v2.4" />
    </>
  ),
  plus: <path d="M12 4.5v15M4.5 12h15" />,
  duplicate: (
    <>
      <rect x="7" y="4" width="13" height="13" rx="2" />
      <rect x="4" y="7" width="13" height="13" rx="2" fill="none" />
    </>
  ),
  "arrow-up": (
    <>
      <path d="M12 20V4" />
      <path d="m6.5 9.5 5.5-5.5 5.5 5.5" />
    </>
  ),
  "arrow-down": (
    <>
      <path d="M12 4v16" />
      <path d="m6.5 14.5 5.5 5.5 5.5-5.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7.5h15" />
      <path d="M9 7.5V5.2c0-.7.5-1.2 1.2-1.2h3.6c.7 0 1.2.5 1.2 1.2v2.3" />
      <path d="m6.5 7.5.8 12.2c0 .6.5 1.1 1.2 1.1h7c.6 0 1.1-.5 1.2-1.1l.8-12.2" />
      <path d="M10 11v5.8M14 11v5.8" />
    </>
  ),
  import: (
    <>
      <path d="M4 12h11" />
      <path d="m11 8 4 4-4 4" />
      <path d="M19.5 4.5h-2v15h2" />
    </>
  ),
  export: (
    <>
      <path d="M20 12H9" />
      <path d="m13 8-4 4 4 4" />
      <path d="M4.5 4.5h2v15h-2" />
    </>
  ),
  play: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8.4 6 3.6-6 3.6Z" fill="currentColor" stroke="none" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" />
      <path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m4.2 17.8 4.7-4.7 3.2 3.2 2.2-2.2 5.5 5.4" />
    </>
  ),
  "zoom-in": (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.3 15.3 5 5M10.5 7.5v6M7.5 10.5h6" />
    </>
  ),
  "zoom-out": (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.3 15.3 5 5M7.5 10.5h6" />
    </>
  ),
  chevron: <path d="m7 9.5 5 5 5-5" />,
  close: <path d="m5.5 5.5 13 13m0-13-13 13" />,
  check: <path d="m4.5 12.5 4.6 4.6L19.5 6.7" />,
  download: (
    <>
      <path d="M12 3.5v11" />
      <path d="m7.5 10 4.5 4.5 4.5-4.5" />
      <path d="M4.5 17.5v2h15v-2" />
    </>
  ),
  upload: (
    <>
      <path d="M12 14.5v-11" />
      <path d="m7.5 8 4.5-4.5L16.5 8" />
      <path d="M4.5 17.5v2h15v-2" />
    </>
  ),
  move: (
    <>
      <path d="M12 3.5v17M3.5 12h17" />
      <path d="M8.5 7 12 3.5 15.5 7M8.5 17l3.5 3.5 3.5-3.5M7 8.5 3.5 12 7 15.5M17 8.5l3.5 3.5-3.5 3.5" />
    </>
  ),
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
};

const chevronRotation: Record<ChevronDirection, number> = {
  down: 0,
  left: 90,
  up: 180,
  right: -90,
};

function resolveIconName(name: PortraitEditorIconName): CoreIconName {
  if (name === "preview") return "play";
  if (name === "reference") return "image";
  return name;
}

export function Icon({
  name,
  size = 24,
  title,
  direction = "down",
  "aria-label": ariaLabel,
  ...svgProps
}: PortraitEditorIconProps) {
  const accessibleLabel = ariaLabel ?? title;
  const glyph = iconGlyphs[resolveIconName(name)];
  const content =
    name === "chevron" && direction !== "down" ? (
      <g transform={`rotate(${chevronRotation[direction]} 12 12)`}>{glyph}</g>
    ) : (
      glyph
    );

  return (
    <svg
      {...svgProps}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={accessibleLabel ? "img" : undefined}
      aria-label={accessibleLabel}
      aria-hidden={accessibleLabel ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {content}
    </svg>
  );
}

function createNamedIcon(name: PortraitEditorIconName, displayName: string) {
  const NamedIcon = (props: NamedIconProps) => <Icon {...props} name={name} />;
  NamedIcon.displayName = displayName;
  return NamedIcon;
}

export const SelectMarqueeIcon = createNamedIcon("select-marquee", "SelectMarqueeIcon");
export const HandIcon = createNamedIcon("hand", "HandIcon");
export const BrushIcon = createNamedIcon("brush", "BrushIcon");
export const EraserIcon = createNamedIcon("eraser", "EraserIcon");
export const LineIcon = createNamedIcon("line", "LineIcon");
export const RectangleIcon = createNamedIcon("rectangle", "RectangleIcon");
export const EllipseIcon = createNamedIcon("ellipse", "EllipseIcon");
export const FillBucketIcon = createNamedIcon("fill-bucket", "FillBucketIcon");
export const EyedropperIcon = createNamedIcon("eyedropper", "EyedropperIcon");
export const LassoIcon = createNamedIcon("lasso", "LassoIcon");
export const UndoIcon = createNamedIcon("undo", "UndoIcon");
export const RedoIcon = createNamedIcon("redo", "RedoIcon");
export const EyeVisibleIcon = createNamedIcon("eye-visible", "EyeVisibleIcon");
export const EyeHiddenIcon = createNamedIcon("eye-hidden", "EyeHiddenIcon");
export const LockIcon = createNamedIcon("lock", "LockIcon");
export const UnlockIcon = createNamedIcon("unlock", "UnlockIcon");
export const PlusIcon = createNamedIcon("plus", "PlusIcon");
export const DuplicateIcon = createNamedIcon("duplicate", "DuplicateIcon");
export const ArrowUpIcon = createNamedIcon("arrow-up", "ArrowUpIcon");
export const ArrowDownIcon = createNamedIcon("arrow-down", "ArrowDownIcon");
export const TrashIcon = createNamedIcon("trash", "TrashIcon");
export const ImportIcon = createNamedIcon("import", "ImportIcon");
export const ExportIcon = createNamedIcon("export", "ExportIcon");
export const PlayIcon = createNamedIcon("play", "PlayIcon");
export const PreviewIcon = createNamedIcon("preview", "PreviewIcon");
export const GridIcon = createNamedIcon("grid", "GridIcon");
export const ImageIcon = createNamedIcon("image", "ImageIcon");
export const ReferenceIcon = createNamedIcon("reference", "ReferenceIcon");
export const ZoomInIcon = createNamedIcon("zoom-in", "ZoomInIcon");
export const ZoomOutIcon = createNamedIcon("zoom-out", "ZoomOutIcon");
export const ChevronIcon = createNamedIcon("chevron", "ChevronIcon");
export const CloseIcon = createNamedIcon("close", "CloseIcon");
export const CheckIcon = createNamedIcon("check", "CheckIcon");
export const DownloadIcon = createNamedIcon("download", "DownloadIcon");
export const UploadIcon = createNamedIcon("upload", "UploadIcon");
export const MoveIcon = createNamedIcon("move", "MoveIcon");
export const MenuIcon = createNamedIcon("menu", "MenuIcon");

export default Icon;
