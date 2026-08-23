import { Fragment } from "react";

/** One look for every shortcut hint in the app: outlined caps joined by +.
 *  Always shown: it labels the button rather than reporting whether the key
 *  happens to be armed, and a hint that came and went made the prompt resize
 *  for no visible reason. */
export function KeyCaps({ keys, className = "" }: { keys: string[]; className?: string }) {
  return (
    <span className={`na-key${className ? " " + className : ""}`}>
      {keys.map((k, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="keyplus">+</span>}
          <kbd className="keycap">{k}</kbd>
        </Fragment>
      ))}
    </span>
  );
}
