import { iconClass } from "../icons";

/** One glyph from the vendored game-icons set. Sized in em, coloured by
 *  currentColor — so the surrounding font-size and --c rules still own it. */
export function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <i className={`${iconClass(name)}${className ? " " + className : ""}`} aria-hidden="true" />;
}
