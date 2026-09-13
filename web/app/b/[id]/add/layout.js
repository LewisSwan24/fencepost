import { use } from "react";
import { DraftProvider } from "./DraftContext";

export default function AddLayout({ children, params }) {
  const { id } = use(params);
  return <DraftProvider storyboardId={id}>{children}</DraftProvider>;
}
