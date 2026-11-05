import type { Viewport } from "next";
import type { ReactNode } from "react";
import { ToastProvider } from "~/components/toast";
import { QueryProvider } from "./providers";
import { ThemeProvider } from "~/lib/theme";
import "./globals.css";

/**
 * Root layout.
 *
 * Deliberately session-free: it wraps both the signed-out screens and the workspace, and the
 * providers below are the only shared state in the app (server cache + toasts).
 */

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
};

export const metadata = {
  title: { default: "Orbita", template: "%s · Orbita" },
  description:
    "Orbita is a project workspace: projects, tasks, assignments and analytics in one place.",
  // A private team tool should not be crawled, and signed-out pages have nothing to index.
  robots: { index: false, follow: false },
};

/**
 * Runs at parse time, before any React code or extension content-scripts execute.
 *
 * Two strategies, layered:
 *
 *  1. PROACTIVE: Override `Element.prototype.setAttribute` to silently drop writes for
 *     known extension marker attributes (`bis_skin_checked`, `bis_register`, `__processed_*`).
 *     This is synchronous and runs first, so Bitdefender's content-script stamp never lands
 *     in the DOM — React never sees it during hydration comparison.
 *
 *  2. REACTIVE (safety net for the small window before our override took effect, plus for
 *     any extension that uses `setAttributeNode` instead): a one-shot sweep of existing
 *     marked nodes plus a `MutationObserver` with `attributes: true` that calls `removeAttribute`
 *     whenever a marker slips through. Both are cheap O(n) passes that run once.
 *
 * The stored/system theme is applied as the final step so the correct `dark` class is on
 * `<html>` from the very first paint.
 */
const BOOT_SCRIPT = `(function(){var P=['bis_skin_checked','bis_register'];function isT(n){return P.indexOf(n)>-1||n.indexOf('__processed_')===0;}try{var s=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(isT(n))return;s.call(this,n,v);};}catch(e){}function clean(el){try{for(var i=el.attributes.length-1;i>=0;i--){var n=el.attributes[i].name;if(isT(n))el.removeAttribute(n);}}catch(e){}}try{var all=document.querySelectorAll('['+P.join('],[')+']');for(var i=0;i<all.length;i++)clean(all[i]);if(window.MutationObserver){new MutationObserver(function(rs){for(var i=0;i<rs.length;i++){var r=rs[i];if(r.type==='attributes'){var t=r.target,a=r.attributeName;if(a&&isT(a))t.removeAttribute(a);}else{for(var j=0;j<r.addedNodes.length;j++){var el=r.addedNodes[j];if(el.nodeType===1)clean(el);}}}}).observe(document.documentElement,{childList:true,subtree:true,attributes:true});}}catch(e){}try{var k='atlas-theme';var t=localStorage.getItem(k)||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var c=document.documentElement.classList;if(d)c.add('dark');else c.remove('dark');document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  // `suppressHydrationWarning` on `<html>` and `<body>` is React's blessed escape hatch for
  // browser extensions that mutate those specific elements (Bitdefender writes `bis_register`
  // and `__processed_*` onto `<body>`). The BOOT_SCRIPT's `setAttribute` interception covers
  // every other element in the tree, including Next.js's internal metadata divs.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body
        className="min-h-full font-sans text-ink antialiased"
        suppressHydrationWarning
      >
        <ThemeProvider>
          <QueryProvider>
            <ToastProvider>{children}</ToastProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
