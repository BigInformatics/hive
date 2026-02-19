import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Hive — Agent Communication Platform" },
      { name: "theme-color", content: "#18181b" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json" },
    ],
    scripts: [
      {
        // Apply theme before render to prevent flash
        children: `(function(){
          var t=localStorage.getItem('hive-theme');
          var d=t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches);
          if(d)document.documentElement.classList.add('dark');
        })()`,
      },
      {
        children: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js')}`,
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
