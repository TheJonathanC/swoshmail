import { Suspense } from "react";
import AppRoot from "@/components/layout/AppRoot";
import LoadingScreen from "@/components/layout/LoadingScreen";

/**
 * /, /mail, /drive and /chat all render this page (see next.config.ts rewrites).
 * AppRoot reads the URL with useSearchParams, so it sits inside a Suspense boundary.
 */
export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <AppRoot />
    </Suspense>
  );
}
