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
  Check,
  ChevronsUpDown,
  FolderOpen,
  Inbox,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu as MenuIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useLogout, useProjects } from "~/lib/hooks";
import {
  inboxPath,
  membersPath,
  myTasksPath,
  projectPath,
  projectsPath,
  settingsPath,
  workspacePath,
} from "~/lib/paths";
import { useRealtime } from "~/lib/realtime";
import type { OrganizationSummary, Session } from "~/lib/types";
import { CreateProjectModal } from "./create-project-modal";
import { CreateWorkspaceForm } from "./create-workspace";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import { Avatar, Menu, MenuItem, Modal } from "./ui";

const SIDEBAR_KEY = "orbita-sidebar-collapsed";

/**
 * Jira-inspired workspace chrome:
 *   top bar  — product, search, create, utilities
 *   sidebar  — essentials + projects (collapsible)
 *   main     — breadcrumbs + page content
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
  const realtime = useRealtime();
  const logout = useLogout();

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (meta && event.key === "[") {
        event.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  const links = [
    {
      href: workspacePath(org.slug, "dashboard"),
      label: "Dashboard",
      icon: LayoutDashboard,
    },
    { href: myTasksPath(org.slug), label: "My work", icon: ListChecks },
    { href: projectsPath(org.slug), label: "Projects", icon: FolderOpen },
    { href: membersPath(org.slug), label: "Members", icon: Users },
    { href: inboxPath(org.slug), label: "Inbox", icon: Inbox },
  ];

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);
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

        <button
          type="button"
          className="btn btn-ghost btn-icon hidden lg:inline-flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggleCollapsed}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setSwitcherOpen(true)}
          className="flex min-w-0 max-w-[11rem] items-center gap-2 rounded-[3px] px-1.5 py-1 text-sm font-semibold text-ink hover:bg-hover sm:max-w-[14rem]"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] bg-accent text-[11px] font-bold text-[rgb(var(--on-accent))]">
            {org.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden truncate sm:inline">{org.name}</span>
          <ChevronsUpDown className="hidden h-3.5 w-3.5 shrink-0 text-ink-faint sm:inline" />
        </button>

        <div className="mx-auto flex min-w-0 flex-1 items-center justify-center gap-2 px-2">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-8 w-full max-w-md items-center gap-2 rounded-[3px] border border-line bg-canvas px-3 text-left text-sm text-ink-muted transition hover:border-line-strong hover:bg-surface"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Search</span>
            <kbd className="kbd hidden sm:inline">⌘K</kbd>
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
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <NotificationBell slug={org.slug} />
          <AccountMenu session={session} />
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1">
        {/* —— Side navigation —— */}
        <aside
          className={clsx(
            "sticky top-12 hidden h-[calc(100vh-3rem)] shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-150 lg:flex",
            collapsed ? "w-14 px-1.5 py-3" : "w-60 px-2.5 py-3",
          )}
        >
          <p
            className={clsx(
              "mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-ink-faint",
              collapsed && "sr-only",
            )}
          >
            For you
          </p>
          <nav className="flex flex-col gap-0.5">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                title={link.label}
                className={clsx(
                  "nav-item",
                  collapsed && "justify-center px-0",
                  isActive(link.href) && "nav-item-active",
                )}
              >
                <link.icon className="h-4 w-4 shrink-0 text-ink-faint" />
                {!collapsed ? link.label : null}
              </Link>
            ))}
          </nav>

          {!collapsed ? (
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
              <ProjectShortlist
                slug={org.slug}
                orgId={org.id}
                activePathname={pathname}
              />
            </div>
          ) : (
            <div className="mt-4 flex justify-center">
              <Link
                href={projectsPath(org.slug)}
                className="btn btn-ghost btn-icon"
                title="Projects"
                aria-label="Projects"
              >
                <FolderOpen className="h-4 w-4" />
              </Link>
            </div>
          )}

          <div
            className={clsx(
              "mt-auto border-t border-line pt-3 text-xs text-ink-faint",
              collapsed
                ? "flex justify-center"
                : "flex items-center justify-between gap-2",
            )}
          >
            <span
              title={
                realtime.status === "live"
                  ? "Live updates connected"
                  : "Live updates not connected"
              }
              className="inline-flex items-center gap-1.5"
            >
              {realtime.status === "offline" ? (
                <WifiOff className="h-3.5 w-3.5" />
              ) : (
                <Wifi
                  className={clsx(
                    "h-3.5 w-3.5",
                    realtime.status === "live" && "text-state-done",
                  )}
                />
              )}
              {!collapsed
                ? realtime.status === "live"
                  ? "Live"
                  : realtime.status === "connecting"
                    ? "Connecting"
                    : "Offline"
                : null}
            </span>
            {!collapsed ? (
              <button
                type="button"
                className="link"
                onClick={() => logout.mutate()}
              >
                Sign out
              </button>
            ) : null}
          </div>
        </aside>

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

      {mobileNav ? (
        <div
          className="fixed inset-0 z-50 bg-backdrop/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileNav(false)}
        >
          <nav
            className="h-full w-72 space-y-1 border-r border-line bg-surface p-3"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSwitcherOpen(true)}
              className="nav-item mb-2 w-full font-semibold"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-[3px] bg-accent text-[11px] font-bold text-[rgb(var(--on-accent))]">
                {org.name.slice(0, 1).toUpperCase()}
              </span>
              {org.name}
            </button>
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileNav(false)}
                className={clsx(
                  "nav-item",
                  isActive(link.href) && "nav-item-active",
                )}
              >
                <link.icon className="h-4 w-4 shrink-0 text-ink-faint" />
                {link.label}
              </Link>
            ))}
            <button
              type="button"
              className="nav-item w-full text-left"
              onClick={() => logout.mutate()}
            >
              <LogOut className="h-4 w-4 shrink-0 text-ink-faint" />
              Sign out
            </button>
          </nav>
        </div>
      ) : null}

      {switcherOpen ? (
        <Modal title="Switch workspace" onClose={() => setSwitcherOpen(false)}>
          <ul className="space-y-1">
            {session.organizations.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  className="nav-item w-full justify-between"
                  onClick={() => {
                    setSwitcherOpen(false);
                    router.push(workspacePath(candidate.slug, "dashboard"));
                  }}
                >
                  <span className="truncate">{candidate.name}</span>
                  <span className="flex items-center gap-2 text-xs text-ink-muted">
                    {candidate.role}
                    {candidate.id === org.id ? (
                      <Check className="h-4 w-4 text-brand-600" />
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-line pt-4">
            <button
              type="button"
              className="nav-item w-full"
              onClick={() => {
                setSwitcherOpen(false);
                setCreateWorkspaceOpen(true);
              }}
            >
              <Plus className="h-4 w-4 shrink-0" />
              Create workspace
            </button>
          </div>
        </Modal>
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
    crumbs.push({ label: "Projects", href: projectsPath(org.slug) });
    crumbs.push({ label: "Board" });
    return crumbs;
  }

  const section = pathname.replace(`${base}/`, "").split("/")[0] || "dashboard";
  const labels: Record<string, string> = {
    dashboard: "Dashboard",
    "my-tasks": "My work",
    projects: "Projects",
    members: "Members",
    inbox: "Inbox",
  };
  crumbs.push({ label: labels[section] ?? section });
  return crumbs;
}

function AccountMenu({ session }: { session: Session }) {
  const router = useRouter();
  const logout = useLogout();
  return (
    <Menu
      align="right"
      trigger={() => (
        <button
          type="button"
          className="rounded-full p-0.5"
          aria-label="Account menu"
        >
          <Avatar user={session.user} />
        </button>
      )}
    >
      <p className="px-2.5 py-1.5 text-xs text-ink-muted">
        {session.user.email}
      </p>
      <MenuItem
        icon={<Settings className="h-4 w-4" />}
        onSelect={() => router.push(settingsPath())}
      >
        Settings
      </MenuItem>
      <MenuItem
        icon={<LogOut className="h-4 w-4" />}
        tone="danger"
        onSelect={() => logout.mutate()}
      >
        Sign out
      </MenuItem>
    </Menu>
  );
}

function ProjectShortlist({
  slug,
  orgId,
  activePathname,
}: {
  slug: string;
  orgId: string;
  activePathname: string;
}) {
  const projects = useProjects(orgId, { status: "active", pageSize: 8 });
  const items = projects.data?.items ?? [];

  return (
    <div className="space-y-0.5">
      <p className="px-2 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
        Projects
      </p>
      {projects.isPending ? (
        <>
          <div className="skeleton h-7" />
          <div className="skeleton h-7" />
        </>
      ) : (
        items.map((project) => (
          <Link
            key={project.id}
            href={projectPath(slug, project.id)}
            className={clsx(
              "nav-item",
              activePathname.startsWith(projectPath(slug, project.id)) &&
                "nav-item-active",
            )}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: project.color }}
              aria-hidden
            />
            <span className="truncate">{project.name}</span>
          </Link>
        ))
      )}
      {items.length === 0 ? (
        <p className="px-2 py-1 text-xs text-ink-faint">No projects yet.</p>
      ) : null}
      <Link href={projectsPath(slug)} className="nav-item text-ink-muted">
        <FolderOpen className="h-4 w-4 shrink-0" />
        View all projects
      </Link>
    </div>
  );
}

/** Lightweight command palette — jump to pages and projects (⌘K). */
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

  const pages = [
    {
      label: "Dashboard",
      href: workspacePath(org.slug, "dashboard"),
      hint: "Overview",
    },
    { label: "My work", href: myTasksPath(org.slug), hint: "Assigned to you" },
    { label: "Projects", href: projectsPath(org.slug), hint: "All projects" },
    { label: "Members", href: membersPath(org.slug), hint: "People" },
    { label: "Inbox", href: inboxPath(org.slug), hint: "Notifications" },
    { label: "Settings", href: settingsPath(), hint: "Account" },
  ].filter(
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
