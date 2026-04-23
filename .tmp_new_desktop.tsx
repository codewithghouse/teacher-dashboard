      {/* ═══════════════════ DESKTOP VIEW — Mobile design, widescreen grid ═══════════════════ */}
      <div className="hidden md:block animate-in fade-in duration-500 -m-4 sm:-m-6 md:-m-8 min-h-[calc(100vh-64px)]"
        style={{ background: "#EEF4FF" }}>
        <div className="max-w-[1600px] mx-auto px-8 pt-8 pb-12">

          {/* ── Header: Greeting + bell + avatar ── */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-[7px] text-[10px] font-extrabold uppercase mb-[8px]" style={{ color: TT3, letterSpacing: "1.8px" }}>
                <span className="w-[6px] h-[6px] rounded-[2px]" style={{ background: B1 }} />
                Teacher Dashboard
              </div>
              <div className="text-[36px] font-extrabold flex items-center gap-3 leading-[1.05]" style={{ color: TT1, letterSpacing: "-1.2px" }}>
                Hello, {firstName}
                <span className="inline-block text-[34px]" style={{ animation: "tdWave 2.8s ease-in-out infinite", transformOrigin: "70% 70%" }}>👋</span>
              </div>
              <div className="text-[14px] font-medium mt-[6px]" style={{ color: TT3, letterSpacing: "-0.15px" }}>
                Welcome back · {dayLabel}
              </div>
            </div>

            <div className="flex items-center gap-3" ref={notifRef}>
              <div className="relative">
                <button type="button" onClick={() => setShowNotifPanel(p => !p)}
                  aria-label="Notifications"
                  className="w-12 h-12 rounded-[14px] bg-white flex items-center justify-center relative hover:scale-[1.04] active:scale-[0.96] transition-transform"
                  style={{ color: B1, boxShadow: "0 0.5px 1px rgba(9,87,247,0.04), 0 4px 12px rgba(9,87,247,0.1)" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/>
                    <path d="M10.3 21a1.94 1.94 0 003.4 0"/>
                  </svg>
                  {unreadNotes.length > 0 && (
                    <span className="absolute top-[4px] right-[4px] min-w-[18px] h-[18px] px-[5px] rounded-full text-white text-[10px] font-extrabold flex items-center justify-center"
                      style={{ background: RED, border: "2px solid white" }}>
                      {unreadNotes.length > 9 ? "9+" : unreadNotes.length}
                    </span>
                  )}
                </button>
                {showNotifPanel && (
                  <div className="absolute right-0 top-14 w-96 rounded-[22px] z-50 overflow-hidden"
                    style={{ background: "#fff", border: `0.5px solid ${BLUE_BDR}`, boxShadow: SH_LG_D }}>
                    <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `0.5px solid ${BLUE_BDR}`, background: "#EEF4FF" }}>
                      <div>
                        <p className="text-[14px] font-bold" style={{ color: TT1, letterSpacing: "-0.2px" }}>Notifications</p>
                        <p className="text-[10px] font-medium mt-[1px]" style={{ color: TT3 }}>
                          {unreadNotes.length > 0 ? `${unreadNotes.length} unread from parents` : "All caught up!"}
                        </p>
                      </div>
                      <button type="button" onClick={() => setShowNotifPanel(false)}
                        className="w-7 h-7 rounded-[9px] flex items-center justify-center"
                        style={{ background: "#fff", border: `0.5px solid ${BLUE_BDR}` }}>
                        <X size={13} style={{ color: TT3 }} />
                      </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {unreadNotes.length === 0 ? (
                        <div className="py-10 text-center text-[13px]" style={{ color: TT4 }}>No new notifications</div>
                      ) : (
                        unreadNotes.map(note => (
                          <button type="button" key={note.id}
                            onClick={() => { setShowNotifPanel(false); navigate("/parent-notes"); }}
                            className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-[color:var(--hv)]"
                            style={{ borderBottom: `0.5px solid ${SEP_D}`, ["--hv" as any]: BG_D }}>
                            <div className="w-9 h-9 rounded-[11px] flex items-center justify-center flex-shrink-0"
                              style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 2px 8px rgba(0,85,255,0.28)" }}>
                              <MessageSquare size={15} color="#fff" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-bold truncate" style={{ color: TT1, letterSpacing: "-0.1px" }}>{note.studentName || "Parent Message"}</p>
                              <p className="text-[11px] mt-[2px] truncate" style={{ color: TT3 }}>{(note.content as string) || "New message received"}</p>
                            </div>
                            <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0" style={{ background: B1 }} />
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button type="button" onClick={() => navigate('/settings')}
                aria-label="Profile"
                className="w-12 h-12 rounded-[14px] flex items-center justify-center text-white text-[17px] font-extrabold hover:scale-[1.04] active:scale-[0.96] transition-transform"
                style={{ background: B1, letterSpacing: "-0.3px", boxShadow: "0 0.5px 1px rgba(9,87,247,0.2), 0 6px 14px rgba(9,87,247,0.3)" }}>
                {avatarInitial}
              </button>
            </div>
          </div>

          {/* ── Hero banner: Attendance Rate ── */}
          <button type="button" onClick={() => navigate('/attendance')}
            className="w-full text-left rounded-[28px] px-8 py-8 relative overflow-hidden hover:scale-[1.004] active:scale-[0.998] transition-transform"
            style={{
              background: "linear-gradient(135deg, #000820 0%, #001466 32%, #0033CC 68%, #0957F7 100%)",
              boxShadow: "0 1px 2px rgba(0,8,60,0.15), 0 12px 32px rgba(0,8,60,0.28)",
            }}>
            <div className="absolute inset-0 pointer-events-none" style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)"
            }} />
            <div className="relative z-[2]">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-[52px] h-[52px] rounded-[15px] flex items-center justify-center text-white"
                  style={{
                    background: "rgba(255,255,255,0.14)",
                    backdropFilter: "blur(22px)",
                    WebkitBackdropFilter: "blur(22px)",
                    border: "0.5px solid rgba(255,255,255,0.22)",
                    boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.15)",
                  }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3v18h18"/>
                    <path d="M7 14l4-4 4 4 5-5"/>
                  </svg>
                </div>
                <div>
                  <div className="text-[11px] font-extrabold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Attendance Rate</div>
                  <div className="text-[12px] font-medium mt-[3px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>Last 30 days · All classes</div>
                </div>
                <div className="ml-auto flex items-center gap-[6px] px-4 py-[7px] rounded-full text-[11px] font-extrabold"
                  style={{
                    background: stats.avgAttendance >= 85 ? "rgba(0,232,102,0.18)" : stats.avgAttendance >= 70 ? "rgba(255,170,0,0.22)" : "rgba(255,51,85,0.18)",
                    border: `0.5px solid ${stats.avgAttendance >= 85 ? "rgba(0,232,102,0.5)" : stats.avgAttendance >= 70 ? "rgba(255,170,0,0.5)" : "rgba(255,51,85,0.5)"}`,
                    color: stats.avgAttendance >= 85 ? "#6FFFAA" : stats.avgAttendance >= 70 ? "#FFD166" : "#FF99AA",
                    letterSpacing: "0.3px",
                  }}>
                  <span className="w-[6px] h-[6px] rounded-full" style={{
                    background: stats.avgAttendance >= 85 ? "#00FF88" : stats.avgAttendance >= 70 ? "#FFCC22" : "#FF5577",
                    boxShadow: `0 0 8px ${stats.avgAttendance >= 85 ? "#00FF88" : stats.avgAttendance >= 70 ? "#FFCC22" : "#FF5577"}`,
                  }} />
                  {stats.avgAttendance >= 85 ? "Strong" : stats.avgAttendance >= 70 ? "Holding" : stats.avgAttendance > 0 ? "Needs focus" : "No data"}
                </div>
              </div>
              <div className="flex items-end justify-between gap-8 flex-wrap">
                <div>
                  <div className="text-[84px] font-extrabold text-white leading-none mb-[6px] flex items-baseline gap-[2px]" style={{ letterSpacing: "-3.8px" }}>
                    {stats.avgAttendance > 0 ? stats.avgAttendance.toFixed(1) : "—"}
                    {stats.avgAttendance > 0 && <span className="text-[40px] font-bold" style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "-1px" }}>%</span>}
                  </div>
                  <div className="text-[14px] font-medium" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "-0.15px" }}>
                    <b className="text-white font-bold">Keep up the great work</b> — real-time data from your classes.
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px] min-w-[380px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                  {[
                    { v: stats.activeClasses, l: "Classes" },
                    { v: stats.atRiskCount, l: "At-Risk" },
                    { v: stats.pendingGrading, l: "Pending" },
                  ].map(({ v, l }) => (
                    <div key={l} className="py-4 px-5 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                      <div className="text-[26px] font-extrabold text-white" style={{ letterSpacing: "-0.8px" }}>{v}</div>
                      <div className="text-[10px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </button>

          {/* ── 4-column stat cards ── */}
          <div className="grid grid-cols-4 gap-4 mt-5">
            {[
              {
                label: "Attendance Rate",
                val: stats.avgAttendance > 0 ? `${stats.avgAttendance}%` : "—",
                color: B1, iconBg: B1,
                sub: stats.avgAttendance >= 85
                  ? <><span className="font-bold" style={{ color: GREEN }}>↑ Strong</span> · last 30d</>
                  : stats.avgAttendance > 0
                    ? <><span className="font-bold" style={{ color: ORANGE }}>● Watch</span> · last 30d</>
                    : <span>Awaiting data</span>,
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="12" width="4" height="9" rx="1"/>
                    <rect x="10" y="8" width="4" height="13" rx="1"/>
                    <rect x="17" y="4" width="4" height="17" rx="1"/>
                  </svg>
                ),
                path: "/attendance",
              },
              {
                label: "Pending Grading",
                val: `${stats.pendingGrading}`,
                color: ORANGE, iconBg: ORANGE,
                sub: stats.pendingGrading === 0
                  ? <span className="font-bold" style={{ color: GREEN }}>✓ All caught up</span>
                  : <><span className="font-bold" style={{ color: ORANGE }}>● {stats.pendingGrading} to grade</span></>,
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="3" width="16" height="18" rx="2"/>
                    <path d="M9 3v4h6V3"/>
                    <path d="M9 13l2 2 4-4"/>
                  </svg>
                ),
                path: "/gradebook",
              },
              {
                label: "At-Risk Students",
                val: `${stats.atRiskCount}`,
                color: RED, iconBg: RED,
                sub: stats.atRiskCount === 0
                  ? <span className="font-bold" style={{ color: GREEN }}>✓ On track</span>
                  : <span className="font-bold" style={{ color: RED }}>● Need outreach</span>,
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 21h20L12 2z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12" y2="17"/>
                  </svg>
                ),
                path: "/risks-alerts",
              },
              {
                label: "Classes Today",
                val: `${stats.activeClasses}`,
                color: VIOLET, iconBg: VIOLET,
                sub: todayClasses.some(c => c.isNow)
                  ? <span className="font-bold" style={{ color: VIOLET }}>● 1 in progress</span>
                  : stats.activeClasses > 0
                    ? <span className="font-bold" style={{ color: VIOLET }}>● Scheduled</span>
                    : <span>None today</span>,
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 11l9-8 9 8"/>
                    <path d="M5 10v10h14V10"/>
                    <path d="M10 20v-6h4v6"/>
                  </svg>
                ),
                path: "/my-classes",
              },
            ].map(({ label, val, color, iconBg, sub, icon, path }) => (
              <button type="button" key={label}
                onClick={() => navigate(path)}
                className="bg-white rounded-[22px] p-5 relative flex flex-col text-left hover:-translate-y-[2px] active:scale-[0.98] transition-all"
                style={{ boxShadow: "0 0.5px 1px rgba(9,87,247,0.04), 0 4px 14px rgba(9,87,247,0.08)" }}>
                <div className="flex items-start gap-[10px] mb-5" style={{ minHeight: 44 }}>
                  <div className="flex-1 min-w-0 text-[11px] font-bold uppercase leading-[1.4] pt-[4px]" style={{ color: TT3, letterSpacing: "1px" }}>
                    {label}
                  </div>
                  <div className="flex-shrink-0 w-[44px] h-[44px] rounded-[13px] flex items-center justify-center text-white"
                    style={{ background: iconBg }}>
                    {icon}
                  </div>
                </div>
                <div className="text-[38px] font-extrabold leading-none" style={{ color, letterSpacing: "-1.6px" }}>{val}</div>
                <div className="text-[12px] font-semibold mt-2 flex items-center gap-[5px]" style={{ color: TT4, letterSpacing: "-0.15px" }}>
                  {sub}
                </div>
              </button>
            ))}
          </div>

          {/* ── 2-column: Today's Classes + Pending Tasks ── */}
          <div className="grid grid-cols-2 gap-4 mt-4">

            {/* Today's Classes */}
            <div className="bg-white rounded-[22px] p-6"
              style={{ boxShadow: "0 0.5px 1px rgba(9,87,247,0.04), 0 4px 14px rgba(9,87,247,0.08)" }}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-[44px] h-[44px] rounded-[13px] flex items-center justify-center text-white" style={{ background: B1 }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-[17px] font-extrabold" style={{ color: TT1, letterSpacing: "-0.4px" }}>Today's Classes</div>
                    <div className="text-[12px] font-semibold mt-[2px]" style={{ color: TT3, letterSpacing: "-0.1px" }}>{todayClasses.length} scheduled</div>
                  </div>
                </div>
                <button type="button" onClick={() => navigate('/my-classes')}
                  className="text-[13px] font-bold flex items-center gap-[2px] py-[6px] px-2 rounded-[8px] hover:bg-[#EEF4FF] transition-colors"
                  style={{ color: B1, letterSpacing: "-0.1px" }}>
                  See all <span className="text-[18px] leading-none opacity-80 -mt-[3px] ml-[2px]">›</span>
                </button>
              </div>
              {todayClasses.length === 0 ? (
                <div className="py-10 text-center text-[13px] font-medium" style={{ color: TT4 }}>No classes scheduled today</div>
              ) : (
                todayClasses.map((cls, idx) => (
                  <button type="button" key={idx}
                    onClick={() => navigate('/my-classes')}
                    className={`w-full flex items-center gap-3 px-4 py-[14px] rounded-[14px] text-left hover:brightness-[0.98] active:scale-[0.995] transition ${idx < todayClasses.length - 1 ? "mb-2" : ""}`}
                    style={{ background: "#F4F7FE" }}>
                    <div className="w-[3px] self-stretch rounded-[3px] flex-shrink-0" style={{
                      background: cls.isNow ? GREEN : idx % 2 === 0 ? B1 : VIOLET,
                      minHeight: 36,
                    }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-bold truncate" style={{ color: TT1, letterSpacing: "-0.25px" }}>{cls.subject}</div>
                      <div className="text-[12px] font-medium mt-[3px] truncate" style={{ color: TT3, letterSpacing: "-0.1px" }}>
                        {cls.className}
                        <span className="mx-[5px]" style={{ color: TT4 }}>·</span>
                        {cls.students} {cls.students === 1 ? "student" : "students"}
                        {cls.time && cls.time !== "—" && !cls.isNow && (
                          <><span className="mx-[5px]" style={{ color: TT4 }}>·</span>{cls.time}</>
                        )}
                      </div>
                    </div>
                    {cls.isNow ? (
                      <div className="flex items-center gap-[5px] px-[11px] py-[6px] rounded-full text-[10px] font-black text-white uppercase flex-shrink-0"
                        style={{ background: GREEN, letterSpacing: "0.6px" }}>
                        <span className="w-[5px] h-[5px] rounded-full bg-white animate-pulse" />
                        Now
                      </div>
                    ) : (
                      <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={TT4} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    )}
                  </button>
                ))
              )}
            </div>

            {/* Pending Tasks */}
            <div className="bg-white rounded-[22px] p-6"
              style={{ boxShadow: "0 0.5px 1px rgba(9,87,247,0.04), 0 4px 14px rgba(9,87,247,0.08)" }}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-[44px] h-[44px] rounded-[13px] flex items-center justify-center text-white" style={{ background: ORANGE }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <polyline points="8 12 11 15 16 9"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-[17px] font-extrabold" style={{ color: TT1, letterSpacing: "-0.4px" }}>Pending Tasks</div>
                    <div className="text-[12px] font-semibold mt-[2px]" style={{ color: TT3, letterSpacing: "-0.1px" }}>
                      {pendingTasks.length} to complete
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => navigate('/attendance')}
                  className="text-[13px] font-bold flex items-center gap-[2px] py-[6px] px-2 rounded-[8px] hover:bg-[#EEF4FF] transition-colors"
                  style={{ color: B1, letterSpacing: "-0.1px" }}>
                  Add <span className="text-[18px] leading-none opacity-80 -mt-[3px] ml-[2px]">›</span>
                </button>
              </div>
              {pendingTasks.length === 0 ? (
                <div className="py-10 text-center text-[13px] font-medium" style={{ color: TT4 }}>All tasks complete</div>
              ) : (
                pendingTasks.map((task, idx) => (
                  <button type="button" key={idx}
                    onClick={() => navigate(task.title.toLowerCase().includes('attendance') ? '/attendance' : '/gradebook')}
                    className={`w-full flex items-center gap-3 p-4 rounded-[14px] relative overflow-hidden text-left hover:brightness-[0.98] active:scale-[0.995] transition-transform ${idx < pendingTasks.length - 1 ? "mb-2" : ""}`}
                    style={{ background: "rgba(255,136,0,0.06)" }}>
                    <div className="absolute left-0 top-[16px] bottom-[16px] w-[3px] rounded-r-[3px]" style={{ background: ORANGE }} />
                    <div className="w-[40px] h-[40px] rounded-[13px] flex items-center justify-center text-white flex-shrink-0 ml-1"
                      style={{ background: ORANGE }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 11l3 3L22 4"/>
                        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-bold" style={{ color: TT1, letterSpacing: "-0.25px", textDecoration: task.done ? "line-through" : "none" }}>{task.title}</div>
                      <div className="text-[12px] font-bold mt-[3px]" style={{ color: ORANGE, letterSpacing: "-0.1px" }}>{task.sub}</div>
                    </div>
                    <div className="px-[12px] py-[6px] rounded-full text-[10px] font-black text-white uppercase flex-shrink-0"
                      style={{ background: ORANGE, letterSpacing: "0.7px" }}>
                      {task.status === 'Pending' ? 'Pending' : 'Todo'}
                    </div>
                  </button>
                ))
              )}
            </div>

          </div>

          {/* ── 2-column: Needs Attention + AI Intelligence ── */}
          <div className="grid grid-cols-2 gap-4 mt-4">

            {/* Needs Attention */}
            <div className="bg-white rounded-[22px] p-6"
              style={{ boxShadow: "0 0.5px 1px rgba(9,87,247,0.04), 0 4px 14px rgba(9,87,247,0.08)" }}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-[44px] h-[44px] rounded-[13px] flex items-center justify-center text-white" style={{ background: RED }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2L2 21h20L12 2z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12" y2="17"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-[17px] font-extrabold" style={{ color: TT1, letterSpacing: "-0.4px" }}>Needs Attention</div>
                    <div className="text-[12px] font-semibold mt-[2px]" style={{ color: TT3, letterSpacing: "-0.1px" }}>{criticalStudents.length} flagged</div>
                  </div>
                </div>
                <button type="button" onClick={() => navigate('/risks-alerts')}
                  className="text-[13px] font-bold flex items-center gap-[2px] py-[6px] px-2 rounded-[8px] hover:bg-[#EEF4FF] transition-colors"
                  style={{ color: B1, letterSpacing: "-0.1px" }}>
                  View all <span className="text-[18px] leading-none opacity-80 -mt-[3px] ml-[2px]">›</span>
                </button>
              </div>
              {criticalStudents.length === 0 ? (
                <div className="py-10 text-center text-[13px] font-medium" style={{ color: TT4 }}>All students on track</div>
              ) : (
                criticalStudents.map((s, idx) => {
                  const name = s.studentName || "Student";
                  const initStr = (() => { const p = name.trim().split(" "); return (p.length >= 2 ? p[0][0] + p[1][0] : p[0].substring(0, 2)).toUpperCase(); })();
                  const avatarBg = [B1, ORANGE, VIOLET][idx % 3];
                  return (
                    <div key={idx}
                      onClick={() => navigate(`/students?studentId=${s.studentId || ''}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/students?studentId=${s.studentId || ''}`); }}
                      className={`flex items-center gap-3 p-3 pl-4 rounded-[14px] cursor-pointer hover:brightness-[0.97] transition ${idx < criticalStudents.length - 1 ? "mb-2" : ""}`}
                      style={{ background: "rgba(255,51,85,0.04)" }}>
                      <div className="w-[42px] h-[42px] rounded-[13px] flex items-center justify-center text-white text-[12px] font-extrabold flex-shrink-0"
                        style={{ background: avatarBg, letterSpacing: "0.3px" }}>
                        {initStr}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-bold truncate" style={{ color: TT1, letterSpacing: "-0.25px" }}>{name}</div>
                        <div className="flex items-center gap-[5px] mt-[3px] text-[12px] font-semibold" style={{ color: RED, letterSpacing: "-0.1px" }}>
                          <span className="w-[5px] h-[5px] rounded-full flex-shrink-0" style={{ background: RED }} />
                          <span className="truncate">{s.trigger}</span>
                        </div>
                      </div>
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); navigate('/risks-alerts'); }}
                        className="px-4 py-[9px] rounded-[11px] text-[12px] font-bold text-white flex-shrink-0 hover:scale-[1.04] active:scale-[0.95] transition-transform"
                        style={{ background: RED, letterSpacing: "-0.1px" }}>
                        Notify
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* AI Teacher Intelligence */}
            <div className="rounded-[26px] p-7 relative overflow-hidden"
              style={{
                background: "linear-gradient(140deg, #000820 0%, #001888 28%, #0033CC 64%, #0957F7 100%)",
                boxShadow: "0 1px 2px rgba(0,8,60,0.18), 0 12px 32px rgba(0,8,60,0.3)",
              }}>
              <div className="absolute inset-0 pointer-events-none" style={{
                background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)"
              }} />
              <div className="relative z-[2]">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-[48px] h-[48px] rounded-[14px] flex items-center justify-center text-[22px]"
                    style={{
                      background: "rgba(255,255,255,0.14)",
                      backdropFilter: "blur(22px)",
                      WebkitBackdropFilter: "blur(22px)",
                      border: "0.5px solid rgba(255,255,255,0.22)",
                      color: "#FFDD55",
                      boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.15)",
                    }}>⚡</div>
                  <div className="text-[11px] font-black uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.9px" }}>AI Teacher Intelligence</div>
                  <div className="ml-auto px-[11px] py-[5px] rounded-full text-[10px] font-extrabold"
                    style={{
                      background: "rgba(123,63,244,0.3)",
                      border: "0.5px solid rgba(155,95,255,0.5)",
                      color: "#DCC8FF",
                      letterSpacing: "0.5px",
                    }}>Live</div>
                </div>
                <div className="text-[14px] font-normal leading-[1.6] mb-5" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.15px" }}>
                  {aiMessage}
                </div>
                <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                  <button type="button" onClick={() => navigate('/attendance')}
                    className="py-4 px-3 text-center hover:brightness-110 transition"
                    style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[22px] font-extrabold" style={{ color: stats.avgAttendance >= 70 ? "#6FFFAA" : "#FF8899", letterSpacing: "-0.6px" }}>
                      {stats.avgAttendance > 0 ? `${stats.avgAttendance}%` : "—"}
                    </div>
                    <div className="text-[10px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Attend.</div>
                  </button>
                  <button type="button" onClick={() => navigate('/risks-alerts')}
                    className="py-4 px-3 text-center hover:brightness-110 transition"
                    style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[22px] font-extrabold" style={{ color: stats.atRiskCount > 0 ? "#FF8899" : "#fff", letterSpacing: "-0.6px" }}>{stats.atRiskCount}</div>
                    <div className="text-[10px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>At-Risk</div>
                  </button>
                  <button type="button" onClick={() => navigate('/my-classes')}
                    className="py-4 px-3 text-center hover:brightness-110 transition"
                    style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[22px] font-extrabold text-white" style={{ letterSpacing: "-0.6px" }}>{stats.activeClasses}</div>
                    <div className="text-[10px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Classes</div>
                  </button>
                </div>
              </div>
            </div>

          </div>

        </div>
      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}