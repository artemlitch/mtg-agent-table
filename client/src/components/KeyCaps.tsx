import { Fragment } from "react";

/** One look for every shortcut hint in the app: outlined caps joined by +.
 *  The whole group hides itself while the window is unfocused — see
 *  `body.unfocused .na-key` — because the shortcut does not work then. */
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
