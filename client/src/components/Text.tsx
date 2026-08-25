// The app's text primitive. Anywhere a string from the game is drawn, this
// draws it — and mana comes out as pips because it goes through withMana on
// the way, not because the caller remembered to ask.
//
// That is the whole point. withMana is a function, and a function you have to
// remember to call is a function that gets forgotten: "{1}" leaked into the
// battlefield caption, the card preview, the Agent tab and half the menus for
// exactly that reason. A component cannot be forgotten in the same way,
// because there is nothing else to reach for — the choice is <Text> or a bare
// <span>, and a bare <span> is the thing that looks wrong in review.
//
// It renders one element and takes that element's own props, so it replaces
// the wrapper a string was already sitting in rather than adding a node:
//
//     <div className="msg sys">{e.text}</div>
//     <Text as="div" className="msg sys">{e.text}</Text>
//
// `as` defaults to a span. Children are a string — deliberately not ReactNode,
// so a block of mixed JSX cannot be passed in and quietly skip the transform.
//
// Two transforms run here now — mana pips and card-name links — and both for
// the same reason. Neither is a component the caller composes; they are what
// <Text> IS.
import type { ComponentPropsWithoutRef, ElementType } from "react";
import { withCardLinks } from "./CardLink";
import { withMana } from "./Mana";

type TextProps<T extends ElementType> = {
  /** the element to render — span, div, b, h3… */
  as?: T;
  children?: string | number | null | undefined;
} & Omit<ComponentPropsWithoutRef<T>, "children" | "as">;

export function Text<T extends ElementType = "span">({ as, children, ...rest }: TextProps<T>) {
  const As = (as || "span") as ElementType;
  return <As {...rest}>{withCardLinks(children == null ? "" : String(children), withMana)}</As>;
}
