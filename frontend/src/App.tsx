
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import axios from "axios";
import Papa from "papaparse";
import type { LucideIcon } from "lucide-react";
import { GoogleLogin } from "@react-oauth/google";
import type { CredentialResponse } from "@react-oauth/google";
import {
  BarChart3,
  Clock3,
  FileText,
  Inbox,
  LayoutDashboard,
  Mail,
  Plus,
  RefreshCw,
  Send,
  Upload,
  Users,
  AlertCircle,
  Search,
  X,
  LogOut,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import "./App.css";

const API = axios.create({
  baseURL: "http://localhost:5000/api",
});

API.interceptors.request.use((config) => {
  const token = localStorage.getItem("reachinbox_token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

type Campaign = {
  id: string;
  name: string;
  subject: string;
  status: string;
  totalEmails: number;
  createdAt: string;
  _count?: { emails?: number };
  emails?: { status: string }[];
};

type Email = {
  id: string;
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  status: string;
  scheduledAt: string;
  sentAt?: string;
  lastError?: string;
  campaign?: { name: string };
  sender?: { email: string };
};

type Recipient = {
  email: string;
  name?: string;
};

type Tab = "overview" | "campaigns" | "compose" | "sent" | "scheduled";

function getDefaultScheduleTime() {
  const date = new Date(Date.now() + 10 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function App() {
  // Authentication state
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("reachinbox_token")
  );

  const [userEmail, setUserEmail] = useState(
    () => localStorage.getItem("reachinbox_email") || ""
  );

  const [authLoading, setAuthLoading] = useState(false);

  // Dashboard state
  const [tab, setTab] = useState<Tab>("overview");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Campaign form state
  const [campaignName, setCampaignName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipientsText, setRecipientsText] = useState("");

  // Scheduling and rate-limit settings
  const [scheduledAt, setScheduledAt] = useState(getDefaultScheduleTime);
  const [minDelaySeconds, setMinDelaySeconds] = useState("5");
  const [hourlyLimit, setHourlyLimit] = useState("100");

  const [sending, setSending] = useState(false);

  // Google authentication
  const handleGoogleSuccess = async (response: CredentialResponse) => {
    if (!response.credential) {
      toast.error("Google authentication failed. Please try again.");
      return;
    }

    setAuthLoading(true);

    try {
      const result = await API.post("/auth/google", {
        credential: response.credential,
      });

      const receivedToken = result.data.token;
      const email = result.data.user.email;

      localStorage.setItem("reachinbox_token", receivedToken);
      localStorage.setItem("reachinbox_email", email);

      setToken(receivedToken);
      setUserEmail(email);

      toast.success("Welcome to ReachInbox!");
    } catch (error) {
      console.error("Google login error:", error);

      const message = axios.isAxiosError(error)
        ? error.response?.data?.message
        : undefined;

      toast.error(message || "Google login failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  // Logout
  const handleLogout = () => {
    localStorage.removeItem("reachinbox_token");
    localStorage.removeItem("reachinbox_email");

    setToken(null);
    setUserEmail("");
    setCampaigns([]);
    setEmails([]);
    setTab("overview");

    toast.success("You have been logged out.");
  };

  // Load campaigns and emails
  const loadData = useCallback(async () => {
    if (!token) return;

    setLoading(true);

    try {
      const [campaignResponse, emailResponse] = await Promise.all([
        API.get("/campaigns"),
        API.get("/campaigns/emails", {
          params: { page: 1, limit: 100 },
        }),
      ]);

      const campaignData = campaignResponse.data;
      const emailData = emailResponse.data;

      setCampaigns(
        Array.isArray(campaignData)
          ? campaignData
          : campaignData.campaigns ?? campaignData.data ?? []
      );

      setEmails(
        Array.isArray(emailData)
          ? emailData
          : emailData.emails ?? emailData.data ?? []
      );
    } catch (error) {
      console.error("Dashboard loading error:", error);

      if (
        axios.isAxiosError(error) &&
        error.response?.status === 401
      ) {
        handleLogout();
        toast.error("Your session has expired. Please sign in again.");
      } else {
        toast.error(
          "Could not load data. Check that the backend is running."
        );
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Load data after authentication
  useEffect(() => {
    if (token) {
      void loadData();
    } else {
      setCampaigns([]);
      setEmails([]);
    }
  }, [token, loadData]);

  // Email statistics
  const sentEmails = emails.filter(
    (email) => email.status === "SENT"
  );

  const scheduledEmails = emails.filter(
    (email) =>
      email.status === "QUEUED" || email.status === "SCHEDULED"
  );

  const failedEmails = emails.filter(
    (email) => email.status === "FAILED"
  );

  // Parse manually entered recipients
  const parseRecipients = (): Recipient[] => {
    const parsed = recipientsText
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    const result: Recipient[] = [];

    for (const item of parsed) {
      const match = item.match(/^(.*?)\s*<([^<>]+)>$/);

      const email = (match ? match[2] : item).trim();
      const name = match?.[1]?.trim();

      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        result.push({
          email,
          ...(name ? { name } : {}),
        });
      }
    }

    // Remove duplicate email addresses
    return [
      ...new Map(
        result.map((recipient) => [
          recipient.email.toLowerCase(),
          recipient,
        ])
      ).values(),
    ];
  };

  // Import recipients from CSV
  const handleCsv = (file?: File) => {
    if (!file) return;

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,

      complete: (result: Papa.ParseResult<Record<string, string>>) => {
        const rows = result.data;

        const imported = rows
          .map((row: Record<string, string>) => {
            const emailKey = Object.keys(row).find((key) =>
              ["email", "email address", "recipient"].includes(
                key.trim().toLowerCase()
              )
            );

            const nameKey = Object.keys(row).find((key) =>
              ["name", "full name", "recipient name"].includes(
                key.trim().toLowerCase()
              )
            );

            const email = emailKey ? row[emailKey]?.trim() : "";
            const name = nameKey ? row[nameKey]?.trim() : "";

            return email
              ? name
                ? `${name} <${email}>`
                : email
              : "";
          })
          .filter(Boolean);

        if (!imported.length) {
          toast.error(
            "No email addresses found. Use CSV columns named email and name."
          );
          return;
        }

        setRecipientsText((current) =>
          [current.trim(), ...imported].filter(Boolean).join("\n")
        );

        toast.success(`${imported.length} recipients imported.`);
      },

      error: () => {
        toast.error("Could not read this CSV file.");
      },
    });
  };

  // Create a campaign
  const createCampaign = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    const recipients = parseRecipients();

    if (!campaignName.trim() || !subject.trim() || !body.trim()) {
      toast.error(
        "Please complete the campaign name, subject and message."
      );
      return;
    }

    if (!recipients.length) {
      toast.error("Add at least one valid recipient email address.");
      return;
    }

    if (new Date(scheduledAt).getTime() <= Date.now()) {
      toast.error("Please select a future campaign start time.");
      return;
    }

    if (
      !Number.isInteger(Number(minDelaySeconds)) ||
      Number(minDelaySeconds) < 1 ||
      Number(minDelaySeconds) > 3600
    ) {
      toast.error("Delay must be between 1 and 3600 seconds.");
      return;
    }

    if (
      !Number.isInteger(Number(hourlyLimit)) ||
      Number(hourlyLimit) < 1 ||
      Number(hourlyLimit) > 10000
    ) {
      toast.error("Hourly limit must be between 1 and 10000.");
      return;
    }

    setSending(true);

    try {
      await API.post("/campaigns", {
        name: campaignName.trim(),
        subject: subject.trim(),
        body: body.trim(),
        scheduledAt: new Date(scheduledAt).toISOString(),
        minDelaySeconds: Number(minDelaySeconds),
        hourlyLimit: Number(hourlyLimit),
        recipients,
      });

      toast.success("Campaign created and added to the email queue.");

      setCampaignName("");
      setSubject("");
      setBody("");
      setRecipientsText("");
      setScheduledAt(getDefaultScheduleTime());

      await loadData();
      setTab("campaigns");
    } catch (error) {
      console.error("Campaign creation error:", error);

      const message = axios.isAxiosError(error)
        ? error.response?.data?.message ??
          error.response?.data?.error
        : undefined;

      toast.error(
        message || "Campaign creation failed. Check the backend logs."
      );
    } finally {
      setSending(false);
    }
  };

  const navItems: {
    id: Tab;
    label: string;
    icon: LucideIcon;
  }[] = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "campaigns", label: "Campaigns", icon: BarChart3 },
    { id: "compose", label: "New campaign", icon: Plus },
    { id: "sent", label: "Sent emails", icon: Send },
    { id: "scheduled", label: "Scheduled", icon: Clock3 },
  ];

  const visibleEmails = (
    tab === "sent" ? sentEmails : scheduledEmails
  ).filter(
    (email) =>
      email.recipientEmail
        ?.toLowerCase()
        .includes(search.toLowerCase()) ||
      email.subject?.toLowerCase().includes(search.toLowerCase())
  );

  const formatDate = (value?: string) =>
    value ? new Date(value).toLocaleString() : "—";

  // Login screen
  if (!token) {
    return (
      <div className="app-shell">
        <Toaster position="top-right" richColors />

        <main
          style={{
            minHeight: "100vh",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            background: "#f7f7fb",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "420px",
              padding: "42px 32px",
              borderRadius: "20px",
              background: "#ffffff",
              boxShadow: "0 12px 50px rgba(20, 20, 50, 0.08)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "52px",
                height: "52px",
                margin: "0 auto 18px",
                borderRadius: "14px",
                background: "#eeeaff",
                color: "#7655d9",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Mail size={26} />
            </div>

            <h1
              style={{
                margin: "0 0 8px",
                fontSize: "29px",
                fontWeight: 750,
                color: "#191827",
              }}
            >
              Reach<span style={{ color: "#7655d9" }}>Inbox</span>
            </h1>

            <p
              style={{
                margin: "0 0 30px",
                color: "#777586",
                fontSize: "14px",
                lineHeight: 1.6,
              }}
            >
              Sign in to manage your email campaigns and scheduled messages.
            </p>

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                minHeight: "44px",
              }}
            >
              {authLoading ? (
                <span style={{ color: "#777586", fontSize: "14px" }}>
                  Signing you in...
                </span>
              ) : (
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() =>
                    toast.error("Google sign-in was unsuccessful.")
                  }
                  theme="filled_black"
                  shape="pill"
                  text="continue_with"
                />
              )}
            </div>

            <p
              style={{
                marginTop: "28px",
                fontSize: "12px",
                color: "#aaa8b5",
              }}
            >
              Secure authentication powered by Google.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Toaster position="top-right" richColors />

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Mail size={21} />
          </div>

          <span>
            Reach<span className="brand-accent">Inbox</span>
          </span>
        </div>

        <div className="workspace-label">WORKSPACE</div>

        <nav className="nav-list">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${tab === id ? "active" : ""}`}
              onClick={() => {
                setTab(id);
                setSearch("");
              }}
            >
              <Icon size={18} />
              <span>{label}</span>

              {id === "sent" && (
                <span className="nav-count">{sentEmails.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="connection-dot" />
          <div>
            <strong>System status</strong>
            <span>Workspace dashboard</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            {navItems.find((item) => item.id === tab)?.label}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
            }}
          >
            <span
              style={{
                fontSize: "12px",
                color: "#777586",
                maxWidth: "180px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={userEmail}
            >
              {userEmail}
            </span>

            <button
              className="refresh-button"
              onClick={() => void loadData()}
              disabled={loading}
            >
              <RefreshCw
                size={15}
                className={loading ? "spin" : ""}
              />
              Refresh
            </button>

            <button
              className="refresh-button"
              onClick={handleLogout}
              title="Sign out"
            >
              <LogOut size={15} />
              Logout
            </button>
          </div>
        </header>

        <div className="page-content">
          {/* Overview */}
          {tab === "overview" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR EMAIL WORKSPACE</div>

                  <h1>
                    Good day<span className="heading-dot">.</span>
                  </h1>

                  <p>
                    Monitor campaigns and manage your email outreach.
                  </p>
                </div>

                <button
                  className="primary-button"
                  onClick={() => setTab("compose")}
                >
                  <Plus size={17} />
                  Create campaign
                </button>
              </div>

              <section className="stats-grid">
                <StatCard
                  icon={BarChart3}
                  label="Total campaigns"
                  value={campaigns.length}
                  tone="purple"
                />

                <StatCard
                  icon={Send}
                  label="Emails sent"
                  value={sentEmails.length}
                  tone="green"
                />

                <StatCard
                  icon={Clock3}
                  label="Scheduled emails"
                  value={scheduledEmails.length}
                  tone="blue"
                />

                <StatCard
                  icon={AlertCircle}
                  label="Failed emails"
                  value={failedEmails.length}
                  tone="orange"
                />
              </section>

              <section className="content-card">
                <div className="section-heading">
                  <div>
                    <h2>Recent campaigns</h2>
                    <p>Your latest email campaigns</p>
                  </div>

                  <button
                    className="text-button"
                    onClick={() => setTab("campaigns")}
                  >
                    View all <span>→</span>
                  </button>
                </div>

                <CampaignTable
                  campaigns={campaigns.slice(0, 5)}
                  formatDate={formatDate}
                />
              </section>

              <section className="content-card">
                <div className="section-heading">
                  <div>
                    <h2>Recent email activity</h2>
                    <p>Latest email delivery updates</p>
                  </div>
                </div>

                <EmailTable
                  emails={emails.slice(0, 6)}
                  formatDate={formatDate}
                />
              </section>
            </>
          )}

          {/* Campaigns */}
          {tab === "campaigns" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">OUTREACH</div>

                  <h1>
                    Campaigns<span className="heading-dot">.</span>
                  </h1>

                  <p>Track and manage all your campaigns.</p>
                </div>

                <button
                  className="primary-button"
                  onClick={() => setTab("compose")}
                >
                  <Plus size={17} />
                  New campaign
                </button>
              </div>

              <section className="content-card">
                <CampaignTable
                  campaigns={campaigns}
                  formatDate={formatDate}
                />
              </section>
            </>
          )}

          {/* Compose campaign */}
          {tab === "compose" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">CREATE AND SEND</div>

                  <h1>
                    New campaign
                    <span className="heading-dot">.</span>
                  </h1>

                  <p>
                    Prepare your message and add your recipients.
                  </p>
                </div>
              </div>

              <form
                className="content-card compose-card"
                onSubmit={createCampaign}
              >
                <div className="form-section-title">
                  <FileText size={18} />

                  <div>
                    <h2>Campaign details</h2>
                    <p>
                      Give your campaign a name and write your email.
                    </p>
                  </div>
                </div>

                <label>
                  Campaign name

                  <input
                    value={campaignName}
                    onChange={(event) =>
                      setCampaignName(event.target.value)
                    }
                    placeholder="e.g. November product update"
                    required
                  />
                </label>

                <label>
                  Email subject

                  <input
                    value={subject}
                    onChange={(event) =>
                      setSubject(event.target.value)
                    }
                    placeholder="Enter your email subject"
                    required
                  />
                </label>

                <label>
                  Message

                  <textarea
                    value={body}
                    onChange={(event) =>
                      setBody(event.target.value)
                    }
                    rows={7}
                    placeholder="Write your email message..."
                    required
                  />
                </label>

                <div className="form-divider" />

                <div className="form-section-title">
                  <Users size={18} />

                  <div>
                    <h2>Recipients</h2>
                    <p>
                      Add email addresses manually or import a CSV file.
                    </p>
                  </div>
                </div>

                <label className="upload-box">
                  <Upload size={21} />

                  <strong>Import recipients from CSV</strong>

                  <span>
                    CSV should contain an email column and optionally a
                    name column.
                  </span>

                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => {
                      handleCsv(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </label>

                <label>
                  Recipient list

                  <textarea
                    value={recipientsText}
                    onChange={(event) =>
                      setRecipientsText(event.target.value)
                    }
                    rows={7}
                    placeholder={
                      "alex@example.com\nJane Doe <jane@example.com>\nhello@example.com"
                    }
                  />
                </label>

                <div className="recipient-footer">
                  <span>
                    {parseRecipients().length} valid unique recipients
                  </span>

                  <span>One address per line</span>
                </div>

                {/* Scheduling settings */}
                <div className="form-divider" />

                <div className="form-section-title">
                  <Clock3 size={18} />

                  <div>
                    <h2>Scheduling & sending limits</h2>
                    <p>
                      Control when emails start and how quickly they are sent.
                    </p>
                  </div>
                </div>

                <label>
                  Campaign start date and time

                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(event) =>
                      setScheduledAt(event.target.value)
                    }
                    required
                  />
                </label>

                <div className="form-grid">
                  <label>
                    Delay between emails (seconds)

                    <input
                      type="number"
                      min="1"
                      max="3600"
                      value={minDelaySeconds}
                      onChange={(event) =>
                        setMinDelaySeconds(event.target.value)
                      }
                      required
                    />
                  </label>

                  <label>
                    Hourly sending limit

                    <input
                      type="number"
                      min="1"
                      max="10000"
                      value={hourlyLimit}
                      onChange={(event) =>
                        setHourlyLimit(event.target.value)
                      }
                      required
                    />
                  </label>
                </div>

                <div className="submit-row">
                  <span className="schedule-note">
                    <Clock3 size={15} />
                    Emails will be queued according to your schedule.
                  </span>

                  <button
                    className="primary-button"
                    type="submit"
                    disabled={sending}
                  >
                    <Send size={16} />
                    {sending ? "Creating..." : "Create campaign"}
                  </button>
                </div>
              </form>
            </>
          )}

          {/* Sent and scheduled emails */}
          {(tab === "sent" || tab === "scheduled") && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">EMAIL MANAGEMENT</div>

                  <h1>
                    {tab === "sent"
                      ? "Sent emails"
                      : "Scheduled emails"}

                    <span className="heading-dot">.</span>
                  </h1>

                  <p>
                    {tab === "sent"
                      ? "Review emails that have been sent."
                      : "Review emails waiting in the queue."}
                  </p>
                </div>
              </div>

              <section className="content-card">
                <div className="table-toolbar">
                  <div className="table-count">
                    {visibleEmails.length} emails
                  </div>

                  <div className="search-box">
                    <Search size={16} />

                    <input
                      value={search}
                      onChange={(event) =>
                        setSearch(event.target.value)
                      }
                      placeholder="Search recipient or subject..."
                    />

                    {search && (
                      <button
                        type="button"
                        onClick={() => setSearch("")}
                        aria-label="Clear search"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <EmailTable
                  emails={visibleEmails}
                  formatDate={formatDate}
                />
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// Dashboard statistic card
function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}>
        <Icon size={19} />
      </div>

      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-foot">Across your workspace</div>
    </div>
  );
}

// Email/campaign status indicator
function StatusPill({ status }: { status: string }) {
  const value = status?.toUpperCase() || "UNKNOWN";

  const tone =
    value === "SENT" || value === "COMPLETED"
      ? "success"
      : value === "FAILED"
        ? "danger"
        : value === "QUEUED" || value === "SCHEDULED"
          ? "info"
          : "neutral";

  return (
    <span className={`status-pill ${tone}`}>
      <span />
      {value}
    </span>
  );
}

// Campaign table
function CampaignTable({
  campaigns,
  formatDate,
}: {
  campaigns: Campaign[];
  formatDate: (value?: string) => string;
}) {
  if (!campaigns.length) {
    return (
      <EmptyState message="No campaigns yet. Create your first campaign to get started." />
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>CAMPAIGN</th>
            <th>SUBJECT</th>
            <th>RECIPIENTS</th>
            <th>STATUS</th>
            <th>CREATED</th>
          </tr>
        </thead>

        <tbody>
          {campaigns.map((campaign) => (
            <tr key={campaign.id}>
              <td>
                <strong>{campaign.name}</strong>
                <small className="muted-cell">
                  {campaign.id.slice(0, 8)}
                </small>
              </td>

              <td>{campaign.subject}</td>

              <td>
                {campaign.totalEmails ??
                  campaign._count?.emails ??
                  campaign.emails?.length ??
                  0}
              </td>

              <td>
                <StatusPill status={campaign.status} />
              </td>

              <td>{formatDate(campaign.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Email table
function EmailTable({
  emails,
  formatDate,
}: {
  emails: Email[];
  formatDate: (value?: string) => string;
}) {
  if (!emails.length) {
    return (
      <EmptyState message="No email records to display yet." />
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>RECIPIENT</th>
            <th>SUBJECT</th>
            <th>CAMPAIGN</th>
            <th>STATUS</th>
            <th>DATE</th>
          </tr>
        </thead>

        <tbody>
          {emails.map((email) => (
            <tr key={email.id}>
              <td>
                <strong>
                  {email.recipientName || email.recipientEmail}
                </strong>

                <small className="muted-cell">
                  {email.recipientEmail}
                </small>
              </td>

              <td>{email.subject}</td>

              <td>{email.campaign?.name ?? "—"}</td>

              <td>
                <StatusPill status={email.status} />
              </td>

              <td>
                {formatDate(email.sentAt || email.scheduledAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Empty table state
function EmptyState({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <Inbox size={27} />
      <p>{message}</p>
    </div>
  );
}

export default App;
