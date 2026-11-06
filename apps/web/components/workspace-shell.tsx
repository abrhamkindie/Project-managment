"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import clsx from "clsx";
import {
  FolderOpen,
  Menu as MenuIcon,
  Plus,
  Search,
} from "lucide-react";
import { useHotkeys, useProjects } from "~/lib/hooks";
import {
  calendarPath,
  membersPath,
  myTasksPath,
  projectPath,
  projectsPath,
  workspacePath,
} from "~/lib/paths";
import type { OrganizationSummary, Session } from "~/lib/types";
import { CreateProjectModal } from "./create-project-modal";
import { CreateWorkspaceForm } from "./create-workspace";
import { NotificationBell } from "./notification-bell";
import { Menu, MenuItem, Modal } from "./ui";
import { MobileNav, NAV_ITEMS, SidebarNav, visibleNavItems, WorkspaceSwitcherModal } from "./sidebar";

const SIDEBAR_KEY = "zorqen-sidebar-collapsed";

/**
 * Workspace chrome:
 *   top bar  — mobile nav trigger, search, create, notifications
 *   sidebar  — the `components/sidebar` module (nav rail + drawer + switcher)
 *   main     — breadcrumbs + page content
 *
 * Everything nav-shaped lives in the sidebar module; this file only assembles the frame
 * and owns the collapsed flag (persisted) plus the modals the rail triggers.
 */
export function WorkspaceShell({
  session,
  org,
  children,
}: {
  session: Session;
  org: OrganizationSummary;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Global chords: the palette and the rail collapse work on every screen, project pages included.
  useHotkeys({
    "mod+k": () => setSearchOpen(true),
    "mod+[": () => toggleCollapsed(),
    "/": () => setSearchOpen(true),
  });

  // `g ...` jumps and `c` create belong to the shell — except inside a project, where the
  // workspace owns the `g` sequences (board/list/timeline/calendar) and `c` adds a task. Rather
  // than racing two window listeners, the shell stands down for the duration of that route.
  const inProject = /^\/w\/[^/]+\/projects\/[^/?#]+/.test(pathname);
  useHotkeys(
    {
      c: () => setCreateProjectOpen(true),
      "g d": () => router.push(workspacePath(org.slug, "dashboard")),
      "g w": () => router.push(myTasksPath(org.slug)),
      "g p": () => router.push(projectsPath(org.slug)),
      "g c": () => router.push(calendarPath(org.slug)),
      "g m": () => router.push(membersPath(org.slug)),
    },
    { enabled: !inProject },
  );

  const crumbs = useMemo(() => breadcrumbsFor(pathname, org), [pathname, org]);

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      {/* —— Top navigation —— */}
      <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:px-3">
        <button
          type="button"
          className="btn btn-ghost btn-icon lg:hidden"
          aria-label="Open navigation"
          onClick={() => setMobileNav(true)}
        >
          <MenuIcon className="h-5 w-5" />
        </button>

        <div className="mx-auto flex min-w-0 flex-1 items-center justify-center gap-2 px-2">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-8 w-full max-w-md items-center gap-2 rounded-[3px] border border-line bg-canvas px-3 text-left text-sm text-ink-muted transition hover:border-line-strong hover:bg-surface"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Search</span>
            <kbd className="kbd hidden sm:inline">⌘K /</kbd>
          </button>
          <Menu
            align="right"
            trigger={() => (
              <button
                type="button"
                className="btn btn-primary btn-sm shrink-0 gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Create</span>
              </button>
            )}
          >
            <MenuItem
              icon={<FolderOpen className="h-4 w-4" />}
              onSelect={() => setCreateProjectOpen(true)}
            >
              Project
            </MenuItem>
            <MenuItem
              icon={<Plus className="h-4 w-4" />}
              onSelect={() => setCreateWorkspaceOpen(true)}
            >
              Workspace
            </MenuItem>
          </Menu>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <NotificationBell slug={org.slug} />
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1">
        <SidebarNav
          session={session}
          org={org}
          pathname={pathname}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onOpenSwitcher={() => setSwitcherOpen(true)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 items-center gap-1 border-b border-line bg-surface px-4 text-xs text-ink-muted sm:px-5">
            {crumbs.map((crumb, index) => (
              <span
                key={`${crumb.label}-${index}`}
                className="inline-flex min-w-0 items-center gap-1"
              >
                {index > 0 ? <span className="text-ink-faint">/</span> : null}
                {crumb.href && index < crumbs.length - 1 ? (
                  <Link
                    href={crumb.href}
                    className="truncate hover:text-brand-600 hover:underline"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    className={clsx(
                      "truncate",
                      index === crumbs.length - 1 && "font-medium text-ink",
                    )}
                  >
                    {crumb.label}
                  </span>
                )}
              </span>
            ))}
          </div>
          <main className="min-h-0 min-w-0 flex-1">{children}</main>
        </div>
      </div>

      <MobileNav
        open={mobileNav}
        onClose={() => setMobileNav(false)}
        session={session}
        org={org}
        onOpenSwitcher={() => {
          setMobileNav(false);
          setSwitcherOpen(true);
        }}
      />

      {switcherOpen ? (
        <WorkspaceSwitcherModal
          session={session}
          currentOrgId={org.id}
          onClose={() => setSwitcherOpen(false)}
          onCreateWorkspace={() => setCreateWorkspaceOpen(true)}
        />
      ) : null}

      {createWorkspaceOpen ? (
        <Modal
          title="Create workspace"
          description="A new workspace starts empty, with you as its admin."
          onClose={() => setCreateWorkspaceOpen(false)}
        >
          <CreateWorkspaceForm
            onDone={(slug) => router.push(workspacePath(slug, "projects"))}
          />
        </Modal>
      ) : null}

      {createProjectOpen ? (
        <CreateProjectModal
          orgId={org.id}
          slug={org.slug}
          onClose={() => setCreateProjectOpen(false)}
        />
      ) : null}

      {searchOpen ? (
        <SearchModal
          org={org}
          orgId={org.id}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}
    </div>
  );
}

function breadcrumbsFor(
  pathname: string,
  org: OrganizationSummary,
): { label: string; href?: string }[] {
  const base = `/w/${org.slug}`;
  const crumbs: { label: string; href?: string }[] = [
    { label: org.name, href: workspacePath(org.slug, "dashboard") },
  ];

  if (pathname.startsWith(`${base}/projects/`)) {
    crumbs.push({ label: "Projects", href: `${base}/projects` });
    crumbs.push({ label: "Board" });
    return crumbs;
  }

  const section = pathname.replace(`${base}/`, "").split("/")[0] || "dashboard";
  const item = NAV_ITEMS.find((nav) => nav.id === section);
  crumbs.push({ label: item?.label ?? section });
  return crumbs;
}

/** Lightweight command palette — jump to pages and projects (⌘K), driven by the nav table. */
function SearchModal({
  org,
  orgId,
  onClose,
}: {
  org: OrganizationSummary;
  orgId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const projects = useProjects(orgId, {
    status: "active",
    pageSize: 24,
    search: term.trim() || undefined,
  });

  const pages = visibleNavItems
    .map((item) => ({
      label: item.label,
      href: item.href(org.slug),
      hint: item.section === "for-you" ? "For you" : "Workspace",
    }))
    .filter(
      (page) =>
        !term.trim() ||
        page.label.toLowerCase().includes(term.trim().toLowerCase()),
    );

  const projectItems = projects.data?.items ?? [];

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <Modal title="Search" onClose={onClose}>
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            autoFocus
            className="field pl-9"
            placeholder="Jump to a page or project…"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            aria-label="Search"
          />
        </div>

        {pages.length > 0 ? (
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
              Pages
            </p>
            <ul className="space-y-0.5">
              {pages.map((page) => (
                <li key={page.href}>
                  <button
                    type="button"
                    className="nav-item w-full justify-between"
                    onClick={() => go(page.href)}
                  >
                    <span>{page.label}</span>
                    <span className="text-xs text-ink-faint">{page.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
            Projects
          </p>
          {projects.isPending ? <div className="skeleton h-10" /> : null}
          {!projects.isPending && projectItems.length === 0 ? (
            <p className="px-2 py-2 text-sm text-ink-muted">
              No matching projects.
            </p>
          ) : null}
          <ul className="space-y-0.5">
            {projectItems.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  className="nav-item w-full"
                  onClick={() => go(projectPath(org.slug, project.id))}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: project.color }}
                    aria-hidden
                  />
                  <span className="truncate">{project.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
