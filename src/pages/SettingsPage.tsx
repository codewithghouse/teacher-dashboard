const SettingsPage = () => {
  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage your profile and preferences.</p>
        </div>
        <div className="flex gap-3">
          <button className="border px-4 py-2 rounded-lg text-sm font-medium text-foreground">Cancel</button>
          <button className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium">Save Changes</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {["Profile", "Notifications", "Preferences"].map((t, i) => (
          <button key={t} className={`px-4 py-2 text-sm rounded-lg font-medium ${i === 0 ? "bg-primary text-primary-foreground" : "border text-foreground"}`}>{t}</button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Profile */}
        <div className="content-card">
          <h3 className="font-semibold text-foreground mb-4">Profile Information</h3>
          <div className="space-y-4">
            {[
              { label: "Full Name", value: "Priya Sharma" },
              { label: "Email", value: "priya.sharma@school.edu" },
              { label: "Phone", value: "+91 98765 43210" },
              { label: "Subject", value: "Mathematics" },
            ].map((f) => (
              <div key={f.label}>
                <label className="text-sm text-muted-foreground block mb-1">{f.label}</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm bg-card text-foreground" defaultValue={f.value} />
              </div>
            ))}
          </div>
        </div>

        {/* Notifications */}
        <div className="content-card">
          <h3 className="font-semibold text-foreground mb-4">Notification Preferences</h3>
          <div className="space-y-4">
            {[
              "Assignment Submissions",
              "Tests & Exams",
              "Grade Deadlines",
              "Attendance Alerts",
              "Parent Messages",
            ].map((n) => (
              <div key={n} className="flex items-center justify-between">
                <span className="text-sm text-foreground">{n}</span>
                <div className="w-10 h-5 bg-primary rounded-full relative cursor-pointer">
                  <div className="w-4 h-4 bg-primary-foreground rounded-full absolute right-0.5 top-0.5" />
                </div>
              </div>
            ))}
          </div>

          <h3 className="font-semibold text-foreground mb-4 mt-8">Preferences</h3>
          <div className="space-y-4">
            {[
              { label: "Default Class View", value: "Students" },
              { label: "Grade Scale", value: "Percentage" },
              { label: "Date Format", value: "DD/MM/YYYY" },
            ].map((p) => (
              <div key={p.label}>
                <label className="text-sm text-muted-foreground block mb-1">{p.label}</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm bg-card text-foreground">
                  <option>{p.value}</option>
                </select>
              </div>
            ))}
          </div>

          <h3 className="font-semibold text-foreground mb-4 mt-8">Security</h3>
          <div className="space-y-3">
            <button className="border px-4 py-2 rounded-lg text-sm font-medium text-foreground w-full text-left">Change Password</button>
            <button className="border px-4 py-2 rounded-lg text-sm font-medium text-foreground w-full text-left">Enable 2FA</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
