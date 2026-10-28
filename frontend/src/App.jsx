
import { useCallback, useEffect, useState } from "react";
import "./App.css";

const API_URL = "http://localhost:5000/api/applications";

const STATUSES = [
  "Applied",
  "Interview",
  "Offer",
  "Rejected",
  "Accepted",
  "Declined",
];

const NEXT_STATUSES = {
  Applied: ["Interview", "Rejected"],
  Interview: ["Offer", "Rejected"],
  Offer: ["Accepted", "Declined"],
  Rejected: [],
  Accepted: [],
  Declined: [],
};

const EMPTY_FORM = {
  company: "",
  role: "",
  jobType: "Full-time",
  appliedDate: new Date().toLocaleDateString("en-CA"),
  salary: "",
  notes: "",
};

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error("The server returned an invalid response.");
  }

  if (!response.ok || result.success === false) {
    throw new Error(result.message || "Something went wrong.");
  }

  return result;
}

function unwrapList(result) {
  if (Array.isArray(result.data)) return result.data;
  if (Array.isArray(result.data?.applications)) {
    return result.data.applications;
  }
  if (Array.isArray(result.data?.items)) return result.data.items;
  return [];
}

function getApplicationId(application) {
  return application.applicationId || application._id;
}

function formatDate(date) {
  if (!date) return "—";

  const value = String(date).slice(0, 10);
  const parts = value.split("-");

  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }

  return value;
}

function getStatusClass(status) {
  return `status-${String(status || "applied").toLowerCase()}`;
}

function App() {
  const [applications, setApplications] = useState([]);
  const [counts, setCounts] = useState({});
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadApplications = useCallback(async () => {
    setLoading(true);

    try {
      const params = new URLSearchParams();

      if (statusFilter) params.set("status", statusFilter);
      if (companySearch.trim()) {
        params.set("company", companySearch.trim());
      }

      const query = params.toString();
      const listUrl = query ? `${API_URL}?${query}` : API_URL;

      const listResult = await apiRequest(listUrl);
      setApplications(unwrapList(listResult));

      try {
        const statsResult = await apiRequest(`${API_URL}/stats`);
        const statsData = statsResult.data || {};

        setCounts(
          statsData.counts ||
            statsData.statusCounts ||
            statsData
        );
      } catch {
        // Calculate counts locally if the stats endpoint is unavailable.
        // For filtered results, these counts reflect the returned list.
        const localCounts = {};

        STATUSES.forEach((status) => {
          localCounts[status] = 0;
        });

        unwrapList(listResult).forEach((application) => {
          localCounts[application.status] =
            (localCounts[application.status] || 0) + 1;
        });

        setCounts(localCounts);
      }

      setError("");
    } catch (err) {
      setError(
        `${err.message} Check that your backend and MongoDB are running.`
      );
    } finally {
      setLoading(false);
    }
  }, [statusFilter, companySearch]);

  useEffect(() => {
    loadApplications();
  }, [loadApplications]);

  function handleInputChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!form.company.trim() || !form.role.trim()) {
      setError("Please enter both the company name and job role.");
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const selectedDate = new Date(`${form.appliedDate}T00:00:00`);

    if (!form.appliedDate || selectedDate > today) {
      setError("Applied date cannot be in the future.");
      return;
    }

    const payload = {
      company: form.company.trim(),
      role: form.role.trim(),
      jobType: form.jobType,
      salary: form.salary === "" ? null : Number(form.salary),
      notes: form.notes.trim(),
    };

    if (!editingId) {
      payload.appliedDate = form.appliedDate;
    }

    if (
      form.salary !== "" &&
      (!Number.isFinite(Number(form.salary)) || Number(form.salary) < 0)
    ) {
      setError("Please enter a valid non-negative salary.");
      return;
    }

    setSaving(true);

    try {
      if (editingId) {
        await apiRequest(
          `${API_URL}/${encodeURIComponent(editingId)}`,
          {
            method: "PUT",
            body: JSON.stringify(payload),
          }
        );

        setMessage("Application updated successfully.");
      } else {
        await apiRequest(API_URL, {
          method: "POST",
          body: JSON.stringify(payload),
        });

        setMessage("Application added successfully.");
      }

      resetForm();
      await loadApplications();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function startEditing(application) {
    setEditingId(getApplicationId(application));

    setForm({
      company: application.company || "",
      role: application.role || "",
      jobType: application.jobType || "Full-time",
      appliedDate: String(application.appliedDate || "").slice(0, 10),
      salary: application.salary ?? "",
      notes: application.notes || "",
    });

    setMessage("");
    setError("");

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function changeStatus(application, newStatus) {
    if (!newStatus || newStatus === application.status) return;

    setMessage("");
    setError("");

    try {
      await apiRequest(
        `${API_URL}/${encodeURIComponent(getApplicationId(application))}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: newStatus }),
        }
      );

      setMessage(`Status changed to ${newStatus}.`);
      await loadApplications();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteApplication(application) {
    const allowed =
      application.status === "Applied" ||
      ["Rejected", "Accepted", "Declined"].includes(application.status);

    if (!allowed) {
      setError("Applications in Interview or Offer cannot be deleted.");
      return;
    }

    const confirmed = window.confirm(
      `Delete the application for ${application.company} — ${application.role}?`
    );

    if (!confirmed) return;

    setMessage("");
    setError("");

    try {
      await apiRequest(
        `${API_URL}/${encodeURIComponent(getApplicationId(application))}`,
        { method: "DELETE" }
      );

      if (editingId === getApplicationId(application)) resetForm();

      setMessage("Application deleted successfully.");
      await loadApplications();
    } catch (err) {
      setError(err.message);
    }
  }

  function getCount(status) {
    const value = counts[status];

    if (typeof value === "number") return value;

    if (value && typeof value.count === "number") {
      return value.count;
    }

    return 0;
  }

  function isOverdue(application) {
    if (typeof application.isOverdue === "boolean") {
      return application.isOverdue;
    }

    if (application.status !== "Applied" || !application.appliedDate) {
      return false;
    }

    const appliedDate = new Date(
      `${String(application.appliedDate).slice(0, 10)}T00:00:00`
    );

    if (Number.isNaN(appliedDate.getTime())) return false;

    appliedDate.setDate(appliedDate.getDate() + 7);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return today > appliedDate;
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="hero-content">
          <p className="eyebrow">CAREER MANAGEMENT PLATFORM</p>
          <h1>JOB APPLICATION TRACKER</h1>
          <p className="hero-subtitle">
            One workspace to manage applications, track progress, and move
            confidently toward your next opportunity.
          </p>
          <div className="hero-trust">
            <span>✓ Application tracking</span>
            <span>✓ Career progress</span>
          </div>
        </div>

        <div className="hero-icon" aria-hidden="true">
          <svg
            viewBox="0 0 48 48"
            width="38"
            height="38"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect
              x="8"
              y="15"
              width="32"
              height="24"
              rx="4"
              stroke="currentColor"
              strokeWidth="2.5"
            />
            <path
              d="M17 15V11.5C17 10.1 18.1 9 19.5 9H28.5C29.9 9 31 10.1 31 11.5V15"
              stroke="currentColor"
              strokeWidth="2.5"
            />
            <path
              d="M8 24H40M21 24V27H27V24"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </header>

      <section className="stats-grid" aria-label="Application status counts">
        {STATUSES.map((status) => (
          <div className="stat-card" key={status}>
            <span>{status}</span>
            <strong>{getCount(status)}</strong>
          </div>
        ))}
      </section>

      <section className="panel" id="application-form">
        <h2>{editingId ? "Edit Application" : "Add New Application"}</h2>

        {message && <p className="success-message">{message}</p>}
        {error && <p className="error-message">{error}</p>}

        <form className="application-form" onSubmit={handleSubmit}>
          <label>
            Company Name *
            <input
              name="company"
              value={form.company}
              onChange={handleInputChange}
              placeholder="e.g. Infosys"
              required
            />
          </label>

          <label>
            Job Role *
            <input
              name="role"
              value={form.role}
              onChange={handleInputChange}
              placeholder="e.g. Software Developer"
              required
            />
          </label>

          <label>
            Job Type *
            <select
              name="jobType"
              value={form.jobType}
              onChange={handleInputChange}
              required
            >
              <option>Full-time</option>
              <option>Internship</option>
              <option>Contract</option>
            </select>
          </label>

          <label>
            Applied Date *
            <input
              type="date"
              name="appliedDate"
              value={form.appliedDate}
              max={new Date().toLocaleDateString("en-CA")}
              onChange={handleInputChange}
              disabled={Boolean(editingId)}
              required
            />
          </label>

          <label>
            Expected Salary (optional)
            <input
              type="number"
              name="salary"
              min="0"
              value={form.salary}
              onChange={handleInputChange}
              placeholder="e.g. 500000"
            />
          </label>

          <label className="full-width">
            Notes (optional)
            <textarea
              name="notes"
              rows="3"
              value={form.notes}
              onChange={handleInputChange}
              placeholder="Add interview details, reminders, or notes..."
            />
          </label>

          <div className="form-actions full-width">
            <button className="primary-button" type="submit" disabled={saving}>
              {saving
                ? "Saving..."
                : editingId
                  ? "Save Changes"
                  : "Add Application"}
            </button>

            {editingId && (
              <button
                className="secondary-button"
                type="button"
                onClick={resetForm}
              >
                Cancel Edit
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="list-heading">
          <div>
            <h2>Application Overview</h2>
            <p>Manage your opportunities and follow their progress.</p>
          </div>
          <span className="result-count">
            {applications.length} result{applications.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="toolbar">
          <input
            type="search"
            placeholder="Search by company..."
            value={companySearch}
            onChange={(event) => setCompanySearch(event.target.value)}
            aria-label="Search by company"
          />

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="secondary-button"
            onClick={loadApplications}
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="empty-state">Loading applications...</div>
        ) : applications.length === 0 ? (
          <div className="empty-state">
            <h3>No applications found</h3>
            <p>Add an application or change your search and filter.</p>
          </div>
        ) : (
          <div className="applications-grid">
            {applications.map((application) => {
              const id = getApplicationId(application);
              const overdue = isOverdue(application);
              const nextStatuses = NEXT_STATUSES[application.status] || [];
              const history =
                application.statusHistory ||
                application.history ||
                [];

              return (
                <article className="application-card" key={id}>
                  <div className="card-top">
                    <div>
                      <span className="application-id">
                        {application.applicationId || "Application"}
                      </span>
                      <h3>{application.company}</h3>
                      <p>{application.role}</p>
                    </div>

                    <span
                      className={`status-badge ${getStatusClass(application.status)}`}
                    >
                      {application.status}
                    </span>
                  </div>

                  <div className="card-meta">
                    <span>{application.jobType}</span>
                    <span>Applied: {formatDate(application.appliedDate)}</span>
                    {application.salary !== undefined &&
                      application.salary !== null &&
                      application.salary !== "" && (
                        <span>
                          Salary: {Number(application.salary).toLocaleString()}
                        </span>
                      )}
                  </div>

                  {application.followUpDate && (
                    <p>
                      <strong>Follow-up date:</strong>{" "}
                      {formatDate(application.followUpDate)}
                    </p>
                  )}

                  {overdue && (
                    <p className="overdue-badge">Follow-up Overdue</p>
                  )}

                  {application.notes && (
                    <p className="notes">{application.notes}</p>
                  )}

                  {history.length > 0 && (
                    <details className="history">
                      <summary>Status history timeline</summary>
                      <ol>
                        {history.map((entry, index) => (
                          <li key={`${entry.status}-${entry.changedAt || entry.date || index}`}>
                            <strong>{entry.status}</strong>
                            <span>
                              {entry.changedAt || entry.date || entry.timestamp
                                ? new Date(
                                    entry.changedAt ||
                                      entry.date ||
                                      entry.timestamp
                                  ).toLocaleString()
                                : "Date unavailable"}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}

                  <label className="status-control">
                    Change status
                    <select
                      value=""
                      onChange={(event) =>
                        changeStatus(application, event.target.value)
                      }
                      disabled={nextStatuses.length === 0}
                    >
                      <option value="">
                        {nextStatuses.length
                          ? "Select next status"
                          : "Final status"}
                      </option>
                      {nextStatuses.map((status) => (
                        <option value={status} key={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="card-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => startEditing(application)}
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      className="danger-button"
                      disabled={
                        !(
                          application.status === "Applied" ||
                          ["Rejected", "Accepted", "Declined"].includes(
                            application.status
                          )
                        )
                      }
                      onClick={() => deleteApplication(application)}
                      title={
                        ["Interview", "Offer"].includes(application.status)
                          ? "Cannot delete an application in Interview or Offer"
                          : "Delete application"
                      }
                    >
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <footer>
        CareerFlow · Career Management Dashboard
      </footer>
    </main>
  );
}

export default App;
