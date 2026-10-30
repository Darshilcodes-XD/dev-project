import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Activity, ArrowDownUp, ArrowRight, ArrowUpRight, Bell, Boxes, Check, CheckCircle2,
  ChevronDown, ChevronRight, CircleDot, Clock3, Cloud, Code2, Command, Copy, Database,
  Download, ExternalLink, FileText, Filter, Gauge, GitBranch, HardDrive, History,
  LayoutDashboard, ListFilter, Loader2, LockKeyhole, Menu, MoreHorizontal, PackageCheck,
  Play, Plus, RefreshCw, Rocket, Search, Server, Settings2, ShieldCheck, SlidersHorizontal,
  Terminal, TestTube2, TrendingUp, X, XCircle, Zap, CircleHelp, Layers3,
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

type NavKey = 'overview' | 'tests' | 'deployments' | 'builds' | 'kubernetes' | 'health' | 'history' | 'logs' | 'settings'
type Stage = { id: string; name: string; status: string; detail?: string; started_at?: string; completed_at?: string }
type Deployment = {
  id: string; environment: string; version: string; namespace: string; replicas: number; status: string;
  test_total: number; test_passed: number; test_failed: number; build_status: string; cluster_status: string;
  image_tag: string; artifact_path?: string; started_at: string; completed_at?: string; stages: Stage[];
  logs: { time: string; level: string; message: string }[]; failure_injection?: number
}
type TestCase = { name: string; status: string; duration: number; message?: string; details?: string }
type TestRun = { id: string; status: string; total: number; passed: number; failed: number; skipped: number; duration: number; output: string; created_at: string; injected_failure?: number; failures?: { name: string; message: string; details: string }[]; cases?: TestCase[] }
type ToastMessage = { kind: 'success' | 'error' | 'info'; title: string; message?: string }

const navGroups = [
  { label: 'WORKSPACE', items: [
    { key: 'overview' as NavKey, label: 'Overview', icon: LayoutDashboard },
    { key: 'tests' as NavKey, label: 'Automated tests', icon: TestTube2 },
    { key: 'deployments' as NavKey, label: 'Deployments', icon: Rocket },
  ] },
  { label: 'INFRASTRUCTURE', items: [
    { key: 'builds' as NavKey, label: 'Container builds', icon: Boxes },
    { key: 'kubernetes' as NavKey, label: 'Kubernetes', icon: Layers3 },
    { key: 'health' as NavKey, label: 'Application health', icon: Activity },
  ] },
  { label: 'OBSERVABILITY', items: [
    { key: 'history' as NavKey, label: 'Deployment history', icon: History },
    { key: 'logs' as NavKey, label: 'Logs', icon: Terminal },
  ] },
]

const titles: Record<NavKey, { title: string; subtitle: string }> = {
  overview: { title: 'Deployment overview', subtitle: 'Release confidence, from first test to verified rollout.' },
  tests: { title: 'Automated tests', subtitle: 'Run the project test suite and inspect assertion-level results.' },
  deployments: { title: 'Deployment control', subtitle: 'Start a gated release through the complete delivery workflow.' },
  builds: { title: 'Container builds', subtitle: 'Review versioned container packages and build output.' },
  kubernetes: { title: 'Cluster operations', subtitle: 'Inspect workloads and pod readiness in the sandbox cluster.' },
  health: { title: 'Application health', subtitle: 'Check the live service endpoint and review recent health signals.' },
  history: { title: 'Deployment history', subtitle: 'Search release runs, compare outcomes, and inspect details.' },
  logs: { title: 'Activity logs', subtitle: 'A chronological view of pipeline and system events.' },
  settings: { title: 'Workspace settings', subtitle: 'Execution providers, release safeguards, and service configuration.' },
}

async function request<T = any>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  let data: any = {}
  try { data = await response.json() } catch { data = {} }
  if (!response.ok && data.error) throw new Error(data.error)
  if (!response.ok) throw new Error(`Request failed (${response.status})`)
  return data as T
}

function cx(...values: (string | false | null | undefined)[]) { return values.filter(Boolean).join(' ') }
function fmtDate(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}
function timeAgo(value?: string) {
  if (!value) return '—'
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
function statusLabel(status?: string) {
  const labels: Record<string, string> = {
    SUCCEEDED: 'Successful', PASSED: 'Passed', FAILED: 'Failed', BLOCKED: 'Blocked', RUNNING: 'Running',
    QUEUED: 'Queued', WAITING: 'Waiting', PACKAGED: 'Packaged', ROLLED_OUT: 'Rolled out', HEALTHY: 'Healthy',
    UNHEALTHY: 'Unhealthy', SKIPPED: 'Skipped',
  }
  return labels[status || ''] || status || 'Unknown'
}
function statusClass(status?: string) {
  const value = (status || '').toUpperCase()
  if (['SUCCEEDED', 'PASSED', 'HEALTHY', 'ROLLED_OUT'].includes(value)) return 'status-success'
  if (['FAILED', 'BLOCKED', 'UNHEALTHY'].includes(value)) return 'status-danger'
  if (['RUNNING', 'QUEUED', 'PACKAGED'].includes(value)) return 'status-warning'
  return 'status-neutral'
}
function StatusPill({ status, dot = true }: { status?: string; dot?: boolean }) {
  return <span className={cx('status-pill', statusClass(status))}>{dot && <span className="status-dot" />}{statusLabel(status)}</span>
}
function EmptyState({ icon: Icon = FileText, title, description, action }: { icon?: any; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={19} /></div><h3>{title}</h3><p>{description}</p>{action}</div>
}
function CardHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return <div className="card-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div>{action}</div>
}
function MetricCard({ label, value, note, icon: Icon, tone = 'blue', trend }: { label: string; value: string | number; note: string; icon: any; tone?: string; trend?: string }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}><Icon size={18} /></span></div><div className="metric-value">{value}</div><div className="metric-bottom"><span>{note}</span>{trend && <span className="metric-trend"><TrendingUp size={13} />{trend}</span>}</div></div>
}
function PipelineStrip({ stages, empty = false }: { stages?: Stage[]; empty?: boolean }) {
  const defaults = [
    { id: 'source', name: 'Source', detail: 'Application files' },
    { id: 'tests', name: 'Automated tests', detail: 'Pytest suite' },
    { id: 'build', name: 'Container build', detail: 'Versioned package' },
    { id: 'deploy', name: 'Sandbox rollout', detail: 'Cluster resources' },
    { id: 'verify', name: 'Health check', detail: 'HTTP verification' },
  ]
  const lookup = stages || []
  return <div className={cx('pipeline-strip', empty && 'pipeline-empty')}>
    {defaults.map((base, index) => {
      const stage = lookup.find(item => item.id === base.id)
      const state = empty ? 'WAITING' : (stage?.status || 'WAITING')
      const Icon = state === 'PASSED' ? Check : state === 'FAILED' || state === 'BLOCKED' ? X : state === 'RUNNING' ? Loader2 : [GitBranch, TestTube2, Boxes, Layers3, ShieldCheck][index]
      return <div className="pipeline-stage" key={base.id}>
        <div className={cx('pipeline-node', state.toLowerCase())}><Icon size={17} className={state === 'RUNNING' ? 'spin' : ''} /></div>
        <div className="pipeline-copy"><strong>{base.name}</strong><span>{empty ? base.detail : (stage?.detail || statusLabel(state))}</span></div>
        {index < defaults.length - 1 && <div className={cx('pipeline-connector', state === 'PASSED' && 'complete')} />}
      </div>
    })}
  </div>
}

function App() {
  const [active, setActive] = useState<NavKey>('overview')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [dashboard, setDashboard] = useState<any>(null)
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [apiConnected, setApiConnected] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [dash, history] = await Promise.all([request<any>('/api/dashboard'), request<{ items: Deployment[] }>('/api/deployments')])
      setDashboard(dash)
      setDeployments(history.items || [])
      setApiConnected(true)
      setLoading(false)
    } catch (error) {
      setApiConnected(false)
      setLoading(false)
      setToast({ kind: 'error', title: 'Connection issue', message: error instanceof Error ? error.message : 'Unable to reach the application API.' })
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    const interval = window.setInterval(refresh, 4000)
    return () => window.clearInterval(interval)
  }, [refresh])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const page = titles[active]
  const latest = dashboard?.latest_deployment as Deployment | null
  const failedTests = dashboard?.tests?.failed_runs || 0
  const successful = dashboard?.deployments?.successful || 0
  const totalDeployments = dashboard?.deployments?.total || 0
  const currentHealth = dashboard?.health?.status || 'UNKNOWN'

  const navigate = (next: NavKey) => { setActive(next); setMobileOpen(false) }
  const onDeploymentCreated = async (id: string) => {
    await refresh()
    setToast({ kind: 'info', title: 'Pipeline queued', message: `${id} is now running through the release gates.` })
  }

  return <div className="app-shell">
    <aside className={cx('sidebar', mobileOpen && 'sidebar-open')}>
      <div className="brand-lockup"><div className="brand-mark"><Command size={19} strokeWidth={2.4} /></div><div><div className="brand-name">smartdeploy<span>.</span></div><div className="brand-caption">RELEASE AUTOMATION</div></div><button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
      <div className="workspace-switch"><div className="workspace-avatar">SC</div><div className="workspace-copy"><strong>Smart Checker</strong><span>Engineering workspace</span></div><ChevronDown size={15} className="workspace-chevron" /></div>
      <nav className="side-nav">
        {navGroups.map(group => <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map(item => <button key={item.key} className={cx('nav-item', active === item.key && 'active')} onClick={() => navigate(item.key)}><item.icon size={17} strokeWidth={1.9} /><span>{item.label}</span>{item.key === 'deployments' && deployments.some(d => ['RUNNING', 'QUEUED'].includes(d.status)) && <span className="nav-live-dot" />}</button>)}</div>)}
        <div className="nav-group"><div className="nav-label">PREFERENCES</div><button className={cx('nav-item', active === 'settings' && 'active')} onClick={() => navigate('settings')}><Settings2 size={17} strokeWidth={1.9} /><span>Settings</span></button></div>
      </nav>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><CircleHelp size={16} /></div><div><strong>Need a hand?</strong><span>Read the project guide</span></div><ArrowUpRight size={15} /></div><div className="profile-row"><div className="profile-avatar">DM</div><div className="profile-copy"><strong>Workspace owner</strong><span>Administrator</span></div><MoreHorizontal size={18} className="profile-more" /></div></div>
    </aside>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}

    <main className="main-shell">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={20} /></button><div className="breadcrumb">Workspace <ChevronRight size={14} /> <strong>{page.title}</strong></div></div><div className="topbar-right"><div className="search-wrap"><Search size={15} /><input placeholder="Search deployments, logs..." value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} /><kbd>⌘ K</kbd></div><div className="top-divider" /><span className="sandbox-chip"><span /> Sandbox</span><button className="icon-button notification" title="Notifications"><Bell size={17} /><i /></button><div className="top-avatar">DM</div></div></header>
      <div className="page-content">
        <div className="page-header"><div><div className="page-kicker"><span className="kicker-line" /> RELEASE ENGINEERING</div><h1>{page.title}</h1><p>{page.subtitle}</p></div><div className="page-header-actions"><div className={cx('live-indicator', !apiConnected && 'is-offline')}><span className="live-pulse" /> {apiConnected ? 'API connected' : 'API unavailable'}</div>{active === 'overview' && <button className="btn btn-primary" onClick={() => navigate('deployments')}><Plus size={16} /> New deployment</button>}</div></div>
        {loading ? <div className="loading-panel"><Loader2 className="spin" size={22} /><span>Connecting to deployment services…</span></div> : <>
          {active === 'overview' && <OverviewPage dashboard={dashboard} deployments={deployments} onNavigate={navigate} />}
          {active === 'tests' && <TestsPage onToast={setToast} onRefresh={refresh} />}
          {active === 'deployments' && <DeploymentsPage onCreated={onDeploymentCreated} onToast={setToast} />}
          {active === 'builds' && <BuildsPage deployments={deployments} onNavigate={navigate} />}
          {active === 'kubernetes' && <KubernetesPage />}
          {active === 'health' && <HealthPage onToast={setToast} />}
          {active === 'history' && <HistoryPage deployments={deployments} search={globalSearch} />}
          {active === 'logs' && <LogsPage />}
          {active === 'settings' && <SettingsPage />}
        </>}
        <footer className="page-footer"><span>Smart Deployment Checker <span className="footer-dot">·</span> Release workflow v1.0</span><span>Sandbox environment <span className="footer-dot">·</span> <a href="/health" target="_blank" rel="noreferrer">Service health <ExternalLink size={11} /></a></span></footer>
      </div>
    </main>
    {toast && <div className={cx('toast', `toast-${toast.kind}`)}><div className="toast-symbol">{toast.kind === 'success' ? <CheckCircle2 size={18} /> : toast.kind === 'error' ? <XCircle size={18} /> : <CircleDot size={18} />}</div><div><strong>{toast.title}</strong>{toast.message && <span>{toast.message}</span>}</div><button onClick={() => setToast(null)}><X size={15} /></button></div>}
  </div>
}

function OverviewPage({ dashboard, deployments, onNavigate }: { dashboard: any; deployments: Deployment[]; onNavigate: (page: NavKey) => void }) {
  const activeDeployment = deployments.find(d => ['RUNNING', 'QUEUED'].includes(d.status))
  const latest = deployments[0]
  const lastSeven = useMemo(() => {
    const dateLabels = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(); date.setDate(date.getDate() - (6 - index))
      return { key: date.toLocaleDateString('en-CA'), day: date.toLocaleDateString('en', { weekday: 'short' }), releases: 0, blocked: 0 }
    })
    deployments.forEach(deployment => {
      const key = new Date(deployment.started_at).toLocaleDateString('en-CA')
      const row = dateLabels.find(item => item.key === key)
      if (row) { row.releases += 1; if (deployment.status === 'BLOCKED' || deployment.status === 'FAILED') row.blocked += 1 }
    })
    return dateLabels
  }, [deployments])
  const health = dashboard?.health?.status || 'UNKNOWN'
  return <div className="page-stack">
    <div className="metric-grid">
      <MetricCard label="Total deployments" value={dashboard?.deployments?.total ?? 0} note="Across all environments" icon={Rocket} tone="blue" />
      <MetricCard label="Successful releases" value={dashboard?.deployments?.successful ?? 0} note="Verified in sandbox" icon={CheckCircle2} tone="green" trend={deployments.length ? `${Math.round(((dashboard?.deployments?.successful || 0) / deployments.length) * 100)}% success` : undefined} />
      <MetricCard label="Failed test runs" value={dashboard?.tests?.failed_runs ?? 0} note="Release gates enforced" icon={TestTube2} tone="orange" />
      <MetricCard label="Application health" value={statusLabel(health)} note={dashboard?.health ? `Last checked ${timeAgo(dashboard.health.checked_at)}` : 'Run a health check to verify'} icon={Gauge} tone={health === 'HEALTHY' ? 'green' : 'purple'} />
    </div>

    <section className="panel pipeline-panel"><div className="panel-header"><CardHeading eyebrow="DELIVERY WORKFLOW" title="Release pipeline" /><div className="panel-header-right">{activeDeployment ? <StatusPill status={activeDeployment.status} /> : <span className="soft-label"><span className="soft-dot" /> Ready for a new run</span>}</div></div><PipelineStrip stages={activeDeployment?.stages} empty={!activeDeployment} /><div className="pipeline-footer"><div className="pipeline-footnote"><ShieldCheck size={15} /><span>Build and rollout stages remain locked until all required tests pass.</span></div>{activeDeployment ? <button className="text-button" onClick={() => onNavigate('deployments')}>View active run <ArrowRight size={14} /></button> : <button className="text-button" onClick={() => onNavigate('deployments')}>Configure deployment <ArrowRight size={14} /></button>}</div></section>

    <div className="overview-grid">
      <section className="panel chart-panel"><div className="panel-header"><CardHeading eyebrow="ACTIVITY" title="Deployment activity" /><span className="period-select">Last 7 days <ChevronDown size={13} /></span></div><div className="chart-legend"><span><i className="legend-blue" /> Deployments</span><span><i className="legend-orange" /> Blocked</span></div><div className="chart-area">{deployments.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={lastSeven} margin={{ top: 8, right: 5, bottom: 0, left: -22 }}><defs><linearGradient id="releasesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#596be2" stopOpacity={0.18} /><stop offset="95%" stopColor="#596be2" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid stroke="#edf0f6" vertical={false} /><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#9aa4b8', fontSize: 11 }} dy={9} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#9aa4b8', fontSize: 11 }} /><Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e8ecf3', boxShadow: '0 8px 24px rgba(20,35,70,.08)', fontSize: 12 }} /><Area type="monotone" dataKey="releases" name="Deployments" stroke="#596be2" strokeWidth={2.5} fill="url(#releasesFill)" /><Area type="monotone" dataKey="blocked" name="Blocked" stroke="#e6a24b" strokeWidth={2} fill="transparent" /></AreaChart></ResponsiveContainer> : <div className="chart-empty"><div className="chart-empty-icon"><TrendingUp size={19} /></div><strong>Activity will appear here</strong><span>Start a release to build your deployment trend.</span></div>}</div><div className="chart-foot"><span><span className="foot-dot blue-dot" /> {deployments.length} recorded runs</span><span>Updates automatically</span></div></section>
      <section className="panel quick-panel"><CardHeading eyebrow="SYSTEM SNAPSHOT" title="Environment status" /><div className="system-list"><div className="system-item"><div className="system-icon lavender"><Cloud size={17} /></div><div className="system-copy"><strong>Sandbox cluster</strong><span>Virtual orchestration layer</span></div><StatusPill status={dashboard?.infrastructure?.connected ? "HEALTHY" : "WAITING"} /></div><div className="system-item"><div className="system-icon mint"><TestTube2 size={17} /></div><div className="system-copy"><strong>Test runner</strong><span>Pytest subprocess</span></div><StatusPill status={dashboard?.latest_test?.status || "WAITING"} /></div><div className="system-item"><div className="system-icon peach"><Boxes size={17} /></div><div className="system-copy"><strong>Container packager</strong><span>Versioned build context</span></div><StatusPill status={dashboard?.latest_deployment?.build_status || "WAITING"} /></div><div className="system-item"><div className="system-icon sky"><Activity size={17} /></div><div className="system-copy"><strong>Application health</strong><span>{dashboard?.health ? `HTTP ${dashboard.health.http_code}` : 'Awaiting first check'}</span></div><StatusPill status={health} /></div></div><button className="panel-link" onClick={() => onNavigate('kubernetes')}>View infrastructure details <ArrowRight size={14} /></button></section>
    </div>

    <section className="panel table-panel"><div className="panel-header"><CardHeading eyebrow="LATEST ACTIVITY" title="Recent deployments" /><button className="text-button" onClick={() => onNavigate('history')}>View history <ArrowRight size={14} /></button></div>{deployments.length ? <DeploymentTable deployments={deployments.slice(0, 5)} /> : <EmptyState icon={Rocket} title="No deployments yet" description="Your first release will appear here with its test, build, and rollout results." action={<button className="btn btn-secondary btn-small" onClick={() => onNavigate('deployments')}><Plus size={14} /> Create deployment</button>} />}</section>
    <div className="overview-bottom"><div className="info-callout"><div className="info-callout-icon"><LockKeyhole size={16} /></div><div><strong>Release protection is enabled</strong><span>Failed test runs automatically block all downstream stages. Production runs require an additional confirmation.</span></div></div><div className="latest-run-card"><div className="latest-run-label">LATEST RUN</div>{latest ? <><div className="latest-run-value"><span className="mono">{latest.id}</span><StatusPill status={latest.status} /></div><div className="latest-run-meta">{latest.version} <span>·</span> {latest.environment} <span>·</span> {timeAgo(latest.started_at)}</div></> : <div className="latest-run-meta">No release recorded</div>}</div></div>
  </div>
}

function DeploymentTable({ deployments }: { deployments: Deployment[] }) {
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>RUN ID</th><th>VERSION</th><th>TESTS</th><th>CONTAINER</th><th>ROLLOUT</th><th>ENVIRONMENT</th><th>STATUS</th><th>STARTED</th></tr></thead><tbody>{deployments.map(item => <tr key={item.id}><td><span className="mono table-id">{item.id}</span></td><td><span className="version-chip">{item.version}</span></td><td><span className={item.test_failed ? 'text-danger' : 'text-success'}>{item.test_passed}/{item.test_total || '—'}</span></td><td><StatusPill status={item.build_status} /></td><td><StatusPill status={item.cluster_status} /></td><td><span className="environment-label">{item.environment}</span></td><td><StatusPill status={item.status} /></td><td className="muted-cell">{timeAgo(item.started_at)}</td></tr>)}</tbody></table></div>
}

function TestsPage({ onToast, onRefresh }: { onToast: (toast: ToastMessage) => void; onRefresh: () => Promise<void> }) {
  const [runs, setRuns] = useState<TestRun[]>([])
  const [result, setResult] = useState<TestRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [injectFailure, setInjectFailure] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const load = useCallback(async () => { try { const data = await request<{ items: TestRun[] }>('/api/tests'); setRuns(data.items || []) } catch { /* handled by page-level API state */ } }, [])
  useEffect(() => { load() }, [load])
  const run = async () => {
    setBusy(true); setResult(null)
    try {
      const data = await request<TestRun>('/api/tests/run', { method: 'POST', body: JSON.stringify({ inject_failure: injectFailure }) })
      setResult(data); onToast({ kind: data.status === 'PASSED' ? 'success' : 'error', title: data.status === 'PASSED' ? 'Test suite passed' : 'Test suite failed', message: `${data.passed} passed · ${data.failed} failed · ${data.duration}s` })
      await load(); await onRefresh()
    } catch (error) { onToast({ kind: 'error', title: 'Test execution failed', message: error instanceof Error ? error.message : 'Unable to run tests.' }) }
    finally { setBusy(false) }
  }
  const displayed = result || runs[0]
  return <div className="page-stack">
    <div className="action-banner test-banner"><div className="banner-icon purple-icon"><TestTube2 size={20} /></div><div className="banner-copy"><strong>Release test suite</strong><span>Execute the backend Pytest suite in an isolated subprocess. Results are parsed from the generated JUnit report.</span></div><button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? <Loader2 size={16} className="spin" /> : <Play size={15} fill="currentColor" />}{busy ? 'Running tests…' : 'Run tests'}</button></div>
    <div className="metric-grid test-metrics"><MetricCard label="Total tests" value={displayed?.total ?? '—'} note="Latest execution" icon={ListFilter} tone="blue" /><MetricCard label="Passed" value={displayed?.passed ?? '—'} note="Assertions successful" icon={CheckCircle2} tone="green" /><MetricCard label="Failed" value={displayed?.failed ?? '—'} note="Must be resolved" icon={XCircle} tone="orange" /><MetricCard label="Duration" value={displayed ? `${displayed.duration}s` : '—'} note="Measured wall time" icon={Clock3} tone="purple" /></div>
    <div className="test-layout"><section className="panel"><div className="panel-header"><CardHeading eyebrow="ASSERTION RESULTS" title="Test cases" /><span className="soft-label">{displayed ? fmtDate(displayed.created_at) : 'No execution yet'}</span></div>{displayed ? <div className="test-result-list">{(displayed.cases || []).map((testCase, index) => <div className="test-case-row" key={`${testCase.name}-${index}`}><div className={cx('test-case-icon', testCase.status === 'FAILED' && 'test-case-failed', testCase.status === 'SKIPPED' && 'test-case-skipped')}>{testCase.status === 'PASSED' ? <CheckCircle2 size={17} /> : testCase.status === 'FAILED' ? <XCircle size={17} /> : <Clock3 size={17} />}</div><div className="test-case-copy"><strong>{testCase.name}</strong><span>{testCase.message || `Executed in ${Number(testCase.duration || 0).toFixed(3)}s`}</span></div><StatusPill status={testCase.status} /></div>)}{displayed.failed > 0 && <div className="failure-detail-list">{displayed.failures?.map((failure, index) => <div className="failure-detail" key={`${failure.name}-${index}`}><strong>{failure.name}</strong><span>{failure.message}</span><pre>{failure.details}</pre></div>)}</div>}{!(displayed.cases || []).length && <div className="mini-empty">This execution did not produce individual test case details. Review the console output.</div>}</div> : <EmptyState icon={TestTube2} title="No test run recorded" description="Run the suite to see assertion-level results and console output." />}</section>
      <section className="panel test-run-info"><CardHeading eyebrow="EXECUTION DETAILS" title="Run configuration" /><div className="run-config"><div><span>Runner</span><strong>Pytest</strong></div><div><span>Execution</span><strong>Python subprocess</strong></div><div><span>Report format</span><strong>JUnit XML</strong></div><div><span>Safety timeout</span><strong>90 seconds</strong></div></div><div className="fault-option"><label className="toggle-label"><input type="checkbox" checked={injectFailure} onChange={e => setInjectFailure(e.target.checked)} /><span className="toggle-ui" /><span><strong>Exercise release protection</strong><small>Introduce a controlled failing assertion to verify that a failed test blocks downstream stages.</small></span></label></div><div className="result-summary"><div className="result-summary-top"><span>Latest run status</span>{displayed ? <StatusPill status={displayed.status} /> : <span className="soft-label">Awaiting run</span>}</div><div className="result-progress"><span style={{ width: displayed?.total ? `${(displayed.passed / displayed.total) * 100}%` : '0%' }} /></div><div className="result-summary-foot"><span>{displayed ? `${displayed.passed} of ${displayed.total} passed` : 'No results available'}</span><span>{displayed?.skipped || 0} skipped</span></div></div></section></div>
    <section className="panel console-panel"><div className="panel-header"><CardHeading eyebrow="RUN OUTPUT" title="Execution console" /><button className="icon-text-button" disabled={!displayed?.output} onClick={() => displayed?.output && navigator.clipboard?.writeText(displayed.output)}><Copy size={14} /> Copy output</button></div><div className="console-window"><div className="console-toolbar"><span /><span /><span /><label>pytest · terminal</label></div><pre>{displayed?.output || 'Waiting for a test run…\n\nThe actual pytest output will be displayed here.'}</pre></div></section>
  </div>
}

function DeploymentsPage({ onCreated, onToast }: { onCreated: (id: string) => Promise<void>; onToast: (toast: ToastMessage) => void }) {
  const [environment, setEnvironment] = useState('Development')
  const [version, setVersion] = useState('1.0.0')
  const [namespace, setNamespace] = useState('default')
  const [replicas, setReplicas] = useState(2)
  const [injectFailure, setInjectFailure] = useState(false)
  const [confirmProd, setConfirmProd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deployment, setDeployment] = useState<Deployment | null>(null)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<Deployment[]>([])

  const loadHistory = useCallback(async () => { try { const data = await request<{ items: Deployment[] }>('/api/deployments'); setHistory(data.items || []) } catch { /* ignore transient refresh */ } }, [])
  useEffect(() => { loadHistory() }, [loadHistory])
  useEffect(() => {
    if (!deployment || ['SUCCEEDED', 'FAILED', 'BLOCKED'].includes(deployment.status)) return
    const timer = window.setInterval(async () => {
      try {
        const next = await request<Deployment>(`/api/deployments/${deployment.id}`)
        setDeployment(next)
        if (['SUCCEEDED', 'FAILED', 'BLOCKED'].includes(next.status)) { window.clearInterval(timer); setBusy(false); loadHistory() }
      } catch { /* keep polling during a transient request failure */ }
    }, 1200)
    return () => window.clearInterval(timer)
  }, [deployment?.id, deployment?.status, loadHistory])

  const submit = async (productionConfirmed = false) => {
    setBusy(true); setError('')
    try {
      const queued = await request<{ id: string }>('/api/deployments', { method: 'POST', body: JSON.stringify({ environment, version, namespace, replicas, inject_failure: injectFailure, confirm_production: productionConfirmed }) })
      const current = await request<Deployment>(`/api/deployments/${queued.id}`)
      setDeployment(current); setConfirmProd(false); await onCreated(queued.id); await loadHistory()
    } catch (err) { setBusy(false); setError(err instanceof Error ? err.message : 'Unable to start deployment.'); onToast({ kind: 'error', title: 'Deployment not started', message: err instanceof Error ? err.message : 'Request rejected.' }) }
  }
  const handleSubmit = () => { if (environment === 'Production') setConfirmProd(true); else submit(false) }
  const stageIcon = (status: string) => status === 'PASSED' ? <Check size={15} /> : status === 'FAILED' || status === 'BLOCKED' ? <X size={15} /> : status === 'RUNNING' ? <Loader2 size={15} className="spin" /> : <Clock3 size={15} />

  return <div className="deployment-layout">
    <div className="deployment-left"><section className="panel deploy-form-panel"><div className="panel-header"><CardHeading eyebrow="NEW RELEASE" title="Deployment configuration" /><span className="soft-label"><LockKeyhole size={12} /> Gated workflow</span></div><div className="form-grid"><div className="form-field full"><label>Target environment</label><div className="environment-options">{['Development', 'Staging', 'Production'].map(option => <button className={cx('environment-option', environment === option && 'selected', option.toLowerCase())} key={option} onClick={() => setEnvironment(option)}><span className="environment-option-icon">{option === 'Development' ? <Code2 size={16} /> : option === 'Staging' ? <Layers3 size={16} /> : <LockKeyhole size={16} />}</span><span><strong>{option}</strong><small>{option === 'Development' ? 'Fast iteration' : option === 'Staging' ? 'Pre-release validation' : 'Explicit approval required'}</small></span>{environment === option && <CheckCircle2 size={16} className="environment-check" />}</button>)}</div></div><div className="form-field"><label htmlFor="version">Application version</label><input id="version" value={version} onChange={e => setVersion(e.target.value)} placeholder="1.0.0" /></div><div className="form-field"><label htmlFor="namespace">Cluster namespace</label><input id="namespace" value={namespace} onChange={e => setNamespace(e.target.value)} placeholder="default" /></div><div className="form-field full"><div className="field-label-row"><label htmlFor="replicas">Desired replicas</label><span className="replica-value">{replicas}</span></div><input id="replicas" className="range-input" type="range" min="1" max="6" value={replicas} onChange={e => setReplicas(Number(e.target.value))} /><div className="range-scale"><span>1 replica</span><span>6 replicas</span></div></div><div className="form-field full"><label className="toggle-label fault-deploy-toggle"><input type="checkbox" checked={injectFailure} onChange={e => setInjectFailure(e.target.checked)} /><span className="toggle-ui" /><span><strong>Exercise release protection</strong><small>Introduce a controlled failing assertion to confirm downstream stages are blocked.</small></span></label></div></div>{error && <div className="inline-error"><XCircle size={15} /> {error}</div>}<div className="deploy-form-footer"><div className="deploy-policy"><ShieldCheck size={16} /><span>Tests must pass before the container is packaged or the cluster is updated.</span></div><button className="btn btn-primary btn-wide" disabled={busy || !version.trim() || !namespace.trim()} onClick={handleSubmit}>{busy ? <Loader2 size={16} className="spin" /> : <Rocket size={16} />}{busy ? 'Pipeline running…' : 'Run deployment pipeline'} <ArrowRight size={15} /></button></div></section>
      <section className="panel recent-deploy-panel"><CardHeading eyebrow="RECENT RELEASES" title="Latest deployments" />{history.length ? history.slice(0, 4).map(item => <button className="recent-deploy-row" key={item.id} onClick={() => setDeployment(item)}><span className="recent-deploy-icon"><Rocket size={15} /></span><span className="recent-deploy-copy"><strong className="mono">{item.id}</strong><small>{item.version} · {item.environment} · {timeAgo(item.started_at)}</small></span><StatusPill status={item.status} /><ChevronRight size={14} className="recent-chevron" /></button>) : <div className="mini-empty">No releases have been started.</div>}</section></div>
    <div className="deployment-right"><section className="panel live-pipeline-panel"><div className="panel-header"><CardHeading eyebrow="PIPELINE EXECUTION" title="Release progress" /><StatusPill status={deployment?.status || 'WAITING'} /></div>{deployment ? <><div className="release-summary"><div><span className="release-id mono">{deployment.id}</span><strong>Version {deployment.version}</strong><small>{deployment.environment} environment · {deployment.replicas} replicas</small></div><div className="release-summary-icon"><Rocket size={19} /></div></div><div className="vertical-timeline">{deployment.stages?.map((stage, index) => <div className={cx('timeline-item', stage.status.toLowerCase())} key={stage.id}><div className="timeline-rail"><div className="timeline-icon">{stageIcon(stage.status)}</div>{index < deployment.stages.length - 1 && <div className="timeline-line" />}</div><div className="timeline-content"><div className="timeline-head"><strong>{stage.name}</strong><StatusPill status={stage.status} /></div><p>{stage.detail}</p></div></div>)}</div><div className="release-status-note">{deployment.status === 'SUCCEEDED' ? <><CheckCircle2 size={16} /><span>All gates passed. The sandbox rollout was verified against the application's health endpoint.</span></> : deployment.status === 'BLOCKED' ? <><LockKeyhole size={16} /><span>Release blocked. Resolve the failing tests before attempting another rollout.</span></> : deployment.status === 'FAILED' ? <><XCircle size={16} /><span>The pipeline stopped after an infrastructure or verification error. Review the event log below.</span></> : <><Loader2 size={16} className="spin" /><span>Pipeline is progressing. This panel refreshes automatically.</span></>}</div><div className="mini-log-list">{deployment.logs?.slice(-4).map((log, index) => <div key={`${log.time}-${index}`}><span>{fmtDate(log.time)}</span><p>{log.message}</p></div>)}</div></> : <EmptyState icon={GitBranch} title="Pipeline is standing by" description="Configure a release on the left. The pipeline will execute tests, prepare the container package, apply sandbox resources, and verify health." />}</section><div className="pipeline-guard-card"><div className="guard-icon"><ShieldCheck size={17} /></div><div><strong>Automatic release gate</strong><span>A single failed required test blocks packaging, rollout, and final verification.</span></div></div></div>
    {confirmProd && <div className="modal-backdrop"><div className="confirm-modal"><div className="modal-icon"><LockKeyhole size={21} /></div><h2>Confirm production rollout</h2><p>This release will execute the full pipeline for the Production environment. The sandbox cluster will be updated only after all required tests pass.</p><div className="confirm-summary"><span>Version <strong>{version}</strong></span><span>Namespace <strong>{namespace}</strong></span><span>Replicas <strong>{replicas}</strong></span></div><div className="modal-actions"><button className="btn btn-secondary" onClick={() => setConfirmProd(false)}>Cancel</button><button className="btn btn-primary" onClick={() => submit(true)}><LockKeyhole size={15} /> Confirm production</button></div></div></div>}
  </div>
}

function BuildsPage({ deployments, onNavigate }: { deployments: Deployment[]; onNavigate: (page: NavKey) => void }) {
  const [status, setStatus] = useState<any>(null)
  const [selected, setSelected] = useState<Deployment | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => { try { setStatus(await request('/api/docker/status')) } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load build status.') } }, [])
  useEffect(() => { load() }, [load])
  const builds = deployments.filter(item => item.artifact_path)
  return <div className="page-stack"><div className="build-summary-grid"><div className="panel build-engine-card"><div className="build-engine-top"><div className="system-icon lavender"><Boxes size={18} /></div><StatusPill status="HEALTHY" /></div><div className="build-engine-title">Virtual container build provider</div><p>Versioned, checksum-tagged container artifacts are assembled after the required test suite passes.</p><div className="engine-meta"><span>Build provider</span><strong>{status?.engine || 'Loading…'}</strong></div><div className="engine-meta"><span>Local Docker CLI</span><strong>{status?.docker_cli_available ? 'Available' : 'Not installed'}</strong></div></div><div className="panel build-stat-card"><div className="metric-top"><span>Container packages</span><span className="metric-icon blue"><PackageCheck size={18} /></span></div><div className="metric-value">{builds.length}</div><div className="metric-bottom"><span>Successfully assembled contexts</span></div><div className="build-stat-foot"><HardDrive size={14} /> Stored in the workspace artifacts folder</div></div><div className="panel build-stat-card"><div className="metric-top"><span>Last package</span><span className="metric-icon green"><Clock3 size={18} /></span></div><div className="metric-value small-value">{builds[0] ? timeAgo(builds[0].started_at) : '—'}</div><div className="metric-bottom"><span>{builds[0]?.image_tag || 'No package built yet'}</span></div><div className="build-stat-foot"><ShieldCheck size={14} /> Build only after tests pass</div></div></div>
    <section className="panel"><div className="panel-header"><CardHeading eyebrow="BUILD ARTIFACTS" title="Container package history" /><button className="btn btn-secondary btn-small" onClick={load} disabled={busy}><RefreshCw size={14} /> Refresh</button></div>{error && <div className="inline-error">{error}</div>}{builds.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>BUILD / RUN ID</th><th>IMAGE REFERENCE</th><th>ENVIRONMENT</th><th>BUILD STATE</th><th>CREATED</th><th></th></tr></thead><tbody>{builds.map(item => <tr key={item.id}><td><span className="mono table-id">{item.id}</span></td><td><span className="mono image-ref">{item.image_tag}</span></td><td>{item.environment}</td><td><StatusPill status={item.build_status} /></td><td className="muted-cell">{fmtDate(item.started_at)}</td><td><button className="table-action" onClick={() => setSelected(item)}>Details <ArrowUpRight size={13} /></button></td></tr>)}</tbody></table></div> : <EmptyState icon={Boxes} title="No container packages yet" description="A package is created after the automated test gate passes. Start a deployment to begin the workflow." action={<button className="btn btn-secondary btn-small" onClick={() => onNavigate('deployments')}><Plus size={14} /> Start deployment</button>} />}</section>
    <div className="info-callout"><div className="info-callout-icon"><CircleHelp size={16} /></div><div><strong>Container build mode</strong><span>{status?.description || 'Loading build configuration…'} A production-ready Dockerfile is included for building the same application image on a Docker-enabled machine.</span></div></div>
    {selected && <div className="modal-backdrop"><div className="confirm-modal detail-modal"><button className="modal-close" onClick={() => setSelected(null)}><X size={17} /></button><div className="modal-icon"><Boxes size={21} /></div><h2>Container package details</h2><p className="mono detail-id">{selected.id}</p><div className="detail-grid"><div><span>Image reference</span><strong>{selected.image_tag}</strong></div><div><span>Build status</span><StatusPill status={selected.build_status} /></div><div><span>Artifact archive</span><strong>{selected.artifact_path ? selected.artifact_path.split('/').pop() : '—'}</strong></div><div><span>Environment</span><strong>{selected.environment}</strong></div></div><button className="btn btn-secondary btn-wide" onClick={() => setSelected(null)}>Close details</button></div></div>}
  </div>
}

function KubernetesPage() {
  const [data, setData] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showNote, setShowNote] = useState(true)
  const load = useCallback(async () => { setBusy(true); try { setData(await request('/api/kubernetes/status')); setError('') } catch (err) { setError(err instanceof Error ? err.message : 'Unable to reach cluster status.') } finally { setBusy(false) } }, [])
  useEffect(() => { load() }, [load])
  const cluster = data?.cluster
  return <div className="page-stack"><div className="cluster-banner"><div className="cluster-banner-main"><div className="cluster-emblem"><Layers3 size={20} /></div><div><div className="cluster-name-row"><h2>{cluster?.cluster_name || 'smart-sandbox-cluster'}</h2><span className="connected-pill"><i /> Connected</span></div><p>Isolated orchestration workspace · Namespace <strong>{cluster?.namespace || 'default'}</strong></p></div></div><button className="btn btn-white" onClick={load} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Refresh status</button></div>
    {showNote && <div className="sandbox-note"><CircleHelp size={15} /><span>Cluster resources are represented by a virtual sandbox adapter. Pod state and rollout history are maintained by the application; no external Kubernetes cluster is contacted.</span><button onClick={() => setShowNote(false)}><X size={14} /></button></div>}
    <div className="metric-grid cluster-metrics"><MetricCard label="Desired replicas" value={cluster?.desired_replicas ?? 0} note="Configured workload count" icon={Boxes} tone="blue" /><MetricCard label="Available replicas" value={cluster?.available_replicas ?? 0} note="Ready sandbox pods" icon={CheckCircle2} tone="green" /><MetricCard label="Workload" value={cluster?.deployment_name || '—'} note="Deployment resource" icon={Layers3} tone="purple" /><MetricCard label="Service port" value={data?.service?.port || 5000} note={`NodePort ${data?.service?.node_port || 30080}`} icon={Server} tone="orange" /></div>
    <div className="infra-grid"><section className="panel"><div className="panel-header"><CardHeading eyebrow="WORKLOAD" title="Pod inventory" /><StatusPill status={cluster?.available_replicas ? 'HEALTHY' : 'WAITING'} /></div>{cluster?.pods?.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>POD NAME</th><th>STATUS</th><th>READY</th><th>RESTARTS</th><th>AGE</th></tr></thead><tbody>{cluster.pods.map((pod: any) => <tr key={pod.name}><td><span className="pod-name"><span className="pod-cube"><Boxes size={13} /></span>{pod.name}</span></td><td><StatusPill status={pod.status === 'Running' ? 'HEALTHY' : 'FAILED'} /></td><td><span className="text-success"><Check size={13} /> {pod.ready ? 'Ready' : 'Not ready'}</span></td><td>{pod.restarts}</td><td className="muted-cell">{pod.age}</td></tr>)}</tbody></table></div> : <EmptyState icon={Boxes} title="No active workloads" description="A workload appears here after a deployment passes its test and container gates." />}</section><section className="panel resource-panel"><CardHeading eyebrow="RESOURCE CONFIGURATION" title="Service details" /><div className="resource-list"><div><span>Deployment</span><strong>smart-deployment</strong></div><div><span>Service</span><strong>smart-checker-service</strong></div><div><span>Namespace</span><strong>{cluster?.namespace || 'default'}</strong></div><div><span>Application label</span><strong>smart-checker</strong></div><div><span>Container port</span><strong>5000 / TCP</strong></div><div><span>NodePort</span><strong>30080 / TCP</strong></div><div><span>Container image</span><strong className="mono wrap-text">{cluster?.image_tag || 'Not deployed'}</strong></div><div><span>Last rollout</span><strong>{fmtDate(cluster?.updated_at)}</strong></div></div></section></div>{error && <div className="inline-error">{error}</div>}</div>
}

function HealthPage({ onToast }: { onToast: (toast: ToastMessage) => void }) {
  const [history, setHistory] = useState<any[]>([])
  const [current, setCurrent] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => { try { const data = await request<{ items: any[] }>('/api/health/history'); setHistory(data.items || []); if (data.items?.length) setCurrent(data.items[0]) } catch { /* no prior checks */ } }, [])
  useEffect(() => { load() }, [load])
  const check = async () => {
    setBusy(true)
    try { const result = await request('/api/health/check', { method: 'POST', body: JSON.stringify({}) }); setCurrent(result); await load(); onToast({ kind: 'success', title: 'Health check passed', message: `HTTP ${result.http_code} · ${result.response_ms}ms` }) }
    catch (error) { onToast({ kind: 'error', title: 'Health check failed', message: error instanceof Error ? error.message : 'The health endpoint did not respond.' }) }
    finally { setBusy(false) }
  }
  return <div className="page-stack"><section className="health-hero panel"><div className="health-status-icon"><Activity size={24} /></div><div className="health-hero-copy"><div className="eyebrow">CURRENT APPLICATION STATUS</div><h2>{current?.status === 'HEALTHY' ? 'All systems operational' : 'Awaiting health verification'}</h2><p>{current?.message || 'Run a live check against the Flask health endpoint to verify service availability.'}</p></div><div className="health-hero-action"><StatusPill status={current?.status || 'UNKNOWN'} /><button className="btn btn-primary" onClick={check} disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />} Check health</button></div></section>
    <div className="metric-grid health-metrics"><MetricCard label="HTTP response" value={current ? current.http_code : '—'} note="GET /health" icon={Cloud} tone="blue" /><MetricCard label="Response time" value={current ? `${current.response_ms}ms` : '—'} note="Measured on request" icon={Zap} tone="purple" /><MetricCard label="Last checked" value={current ? timeAgo(current.checked_at) : '—'} note={current ? fmtDate(current.checked_at) : 'No checks recorded'} icon={Clock3} tone="green" /><MetricCard label="Checks recorded" value={history.length} note="Most recent 30 checks" icon={History} tone="orange" /></div>
    <div className="health-grid"><section className="panel"><CardHeading eyebrow="ENDPOINTS" title="Service checks" /><div className="endpoint-list"><div className="endpoint-row"><div className="endpoint-method">GET</div><div className="endpoint-copy"><strong>/health</strong><span>Application health contract</span></div><StatusPill status={current?.status || 'WAITING'} /></div><div className="endpoint-row"><div className="endpoint-method">GET</div><div className="endpoint-copy"><strong>/</strong><span>Application entry point</span></div><StatusPill status="WAITING" /></div><div className="endpoint-row"><div className="endpoint-method post">POST</div><div className="endpoint-copy"><strong>/api/deployments</strong><span>Gated release submission</span></div><StatusPill status="WAITING" /></div></div></section><section className="panel"><CardHeading eyebrow="RECENT SIGNALS" title="Health-check history" />{history.length ? <div className="health-history">{history.slice(0, 8).map(row => <div className="health-history-row" key={row.id}><span className={cx('health-history-mark', row.status === 'HEALTHY' && 'good')}><Check size={12} /></span><div><strong>{row.status === 'HEALTHY' ? 'Health check passed' : 'Health check failed'}</strong><span>{fmtDate(row.checked_at)} · HTTP {row.http_code}</span></div><b>{row.response_ms}ms</b></div>)}</div> : <div className="mini-empty">No health checks recorded yet.</div>}</section></div></div>
}

function HistoryPage({ deployments, search }: { deployments: Deployment[]; search: string }) {
  const [filter, setFilter] = useState('All statuses')
  const [environment, setEnvironment] = useState('All environments')
  const [selected, setSelected] = useState<Deployment | null>(null)
  const [query, setQuery] = useState('')
  const fullQuery = (query || search).toLowerCase().trim()
  const filtered = deployments.filter(item => (filter === 'All statuses' || item.status === filter.toUpperCase()) && (environment === 'All environments' || item.environment === environment) && (!fullQuery || `${item.id} ${item.version} ${item.environment} ${item.status}`.toLowerCase().includes(fullQuery)))
  return <div className="page-stack"><section className="panel history-panel"><div className="panel-header"><CardHeading eyebrow="RELEASE RECORDS" title="All deployments" /><span className="soft-label">{filtered.length} records</span></div><div className="filter-toolbar"><div className="table-search"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search run ID or version" /></div><div className="select-wrap"><Filter size={14} /><select value={filter} onChange={e => setFilter(e.target.value)}><option>All statuses</option><option value="SUCCEEDED">Successful</option><option value="FAILED">Failed</option><option value="BLOCKED">Blocked</option><option value="RUNNING">Running</option><option value="QUEUED">Queued</option></select><ChevronDown size={13} /></div><div className="select-wrap"><SlidersHorizontal size={14} /><select value={environment} onChange={e => setEnvironment(e.target.value)}><option>All environments</option><option>Development</option><option>Staging</option><option>Production</option></select><ChevronDown size={13} /></div><button className="icon-text-button" onClick={() => { setQuery(''); setFilter('All statuses'); setEnvironment('All environments') }}><X size={14} /> Clear</button></div>{filtered.length ? <div className="table-scroll"><table className="data-table history-table"><thead><tr><th>DEPLOYMENT ID</th><th>VERSION</th><th>ENVIRONMENT</th><th>TEST RESULTS</th><th>BUILD</th><th>ROLLOUT</th><th>FINAL STATUS</th><th>STARTED</th><th></th></tr></thead><tbody>{filtered.map(item => <tr key={item.id}><td><span className="mono table-id">{item.id}</span></td><td>{item.version}</td><td>{item.environment}</td><td><span className={item.test_failed ? 'text-danger' : 'text-success'}>{item.test_passed}/{item.test_total || '—'}</span></td><td><StatusPill status={item.build_status} /></td><td><StatusPill status={item.cluster_status} /></td><td><StatusPill status={item.status} /></td><td className="muted-cell">{fmtDate(item.started_at)}</td><td><button className="table-action" onClick={() => setSelected(item)}>Details <ArrowUpRight size={13} /></button></td></tr>)}</tbody></table></div> : <EmptyState icon={History} title="No matching deployments" description="Adjust the filters or start a new release to populate deployment history." />}</section>
    {selected && <div className="modal-backdrop"><div className="confirm-modal history-detail-modal"><button className="modal-close" onClick={() => setSelected(null)}><X size={17} /></button><div className="modal-icon"><History size={21} /></div><h2>Deployment details</h2><div className="detail-title-row"><span className="mono detail-id">{selected.id}</span><StatusPill status={selected.status} /></div><div className="detail-grid"><div><span>Version</span><strong>{selected.version}</strong></div><div><span>Environment</span><strong>{selected.environment}</strong></div><div><span>Test result</span><strong>{selected.test_passed}/{selected.test_total} passed · {selected.test_failed} failed</strong></div><div><span>Container</span><StatusPill status={selected.build_status} /></div><div><span>Cluster</span><StatusPill status={selected.cluster_status} /></div><div><span>Started</span><strong>{fmtDate(selected.started_at)}</strong></div></div><div className="detail-timeline">{selected.stages?.map(stage => <div key={stage.id}><span className={cx('detail-stage-dot', stage.status.toLowerCase())} /><strong>{stage.name}</strong><StatusPill status={stage.status} /></div>)}</div><div className="detail-log-box">{selected.logs?.slice(-6).map((log, index) => <p key={index}><span>{fmtDate(log.time)}</span>{log.message}</p>)}</div><button className="btn btn-secondary btn-wide" onClick={() => setSelected(null)}>Close details</button></div></div>}
  </div>
}

function LogsPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [filter, setFilter] = useState('All levels')
  const [query, setQuery] = useState('')
  const load = useCallback(async () => { try { const data = await request<{ items: any[] }>('/api/logs'); setLogs(data.items || []) } catch { /* no logs */ } }, [])
  useEffect(() => { load(); const timer = window.setInterval(load, 4000); return () => window.clearInterval(timer) }, [load])
  const filtered = logs.filter(log => (filter === 'All levels' || log.level === filter.toUpperCase()) && (!query || `${log.message} ${log.source}`.toLowerCase().includes(query.toLowerCase())))
  return <div className="page-stack"><section className="panel logs-panel"><div className="panel-header"><CardHeading eyebrow="SYSTEM EVENTS" title="Event stream" /><button className="icon-text-button" onClick={load}><RefreshCw size={14} /> Refresh</button></div><div className="filter-toolbar"><div className="table-search"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search messages or source" /></div><div className="select-wrap"><ListFilter size={14} /><select value={filter} onChange={e => setFilter(e.target.value)}><option>All levels</option><option>INFO</option><option>ERROR</option><option>WARNING</option></select><ChevronDown size={13} /></div><span className="soft-label">Live refresh · 4s</span></div>{filtered.length ? <div className="event-stream">{filtered.map(log => <div className="event-row" key={log.id}><span className={cx('event-level', log.level.toLowerCase())}>{log.level}</span><span className="event-source">{log.source}</span><p>{log.message}</p><time>{fmtDate(log.created_at)}</time></div>)}</div> : <EmptyState icon={Terminal} title="No events recorded" description="Pipeline and health-check events will appear here as you use the workspace." />}</section></div>
}

function SettingsPage() {
  const [settings, setSettings] = useState<any>(null)
  const [error, setError] = useState('')
  useEffect(() => { request('/api/settings').then(setSettings).catch(err => setError(err.message)) }, [])
  return <div className="settings-layout"><div className="settings-main"><section className="panel settings-panel"><CardHeading eyebrow="EXECUTION ENVIRONMENT" title="Infrastructure providers" /><div className="provider-row"><div className="provider-icon violet"><Layers3 size={18} /></div><div className="provider-copy"><strong>Sandbox orchestration layer</strong><span>Stateful orchestration adapter · isolated workspace</span></div><span className="connected-pill"><i /> Active</span></div><div className="provider-row"><div className="provider-icon blue"><TestTube2 size={18} /></div><div className="provider-copy"><strong>Pytest execution engine</strong><span>Runs the actual backend test suite as a subprocess</span></div><span className="connected-pill"><i /> Active</span></div><div className="provider-row"><div className="provider-icon orange"><Boxes size={18} /></div><div className="provider-copy"><strong>Container artifact builder</strong><span>Creates a versioned, checksum-tagged artifact after tests pass</span></div><span className="connected-pill"><i /> Active</span></div></section>
    <section className="panel settings-panel"><CardHeading eyebrow="RELEASE SAFEGUARDS" title="Deployment policies" /><div className="policy-row"><div><strong>Test gate</strong><span>All required tests must pass before the build stage can begin.</span></div><span className="policy-enabled"><Check size={13} /> Enforced</span></div><div className="policy-row"><div><strong>Production approval</strong><span>Production deployments require an explicit confirmation action.</span></div><span className="policy-enabled"><Check size={13} /> Enforced</span></div><div className="policy-row"><div><strong>Replica limit</strong><span>Sandbox deployment requests are limited to 1–10 replicas.</span></div><span className="policy-enabled"><Check size={13} /> Enforced</span></div><div className="policy-row"><div><strong>Command execution</strong><span>No shell command can be submitted from the browser.</span></div><span className="policy-enabled"><Check size={13} /> Enforced</span></div></section></div>
    <div className="settings-side"><section className="panel config-panel"><CardHeading eyebrow="RUNTIME CONFIGURATION" title="Application details" /><div className="config-list"><div><span>Application</span><strong>{settings?.application || 'Smart Deployment Checker'}</strong></div><div><span>Infrastructure mode</span><strong>Sandbox</strong></div><div><span>Test execution</span><strong>Actual Pytest</strong></div><div><span>Container output</span><strong>SHA-256 tagged artifact</strong></div><div><span>Orchestration</span><strong>Virtual cluster</strong></div><div><span>Database</span><strong>SQLite</strong></div></div></section><div className="settings-disclaimer"><div className="disclaimer-icon"><CircleHelp size={17} /></div><strong>How this workspace operates</strong><p>The Flask API and test suite execute as normal application processes. The release workflow runs those tests, assembles a versioned container artifact, updates the virtual cluster state, and checks the service health route. Infrastructure providers are intentionally isolated from external registries and Kubernetes clusters.</p><p>The Dockerfile is included for deployment on a Docker-capable host. Hosted free-tier local storage may be temporary.</p></div></div>{error && <div className="inline-error">{error}</div>}</div>
}

export default App
