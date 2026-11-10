import {
  LayoutDashboard,
  Users,
  DoorOpen,
  BookOpen,
  GraduationCap,
  Calendar,
  Zap,
  School,
  LogOut,
  HelpCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSchedulingStore } from "@/store/schedulingStore";
import { cn } from "@/lib/utils";
import ChangePasswordButton from "@/components/ChangePasswordButton";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "programs", label: "Programs", icon: School },
  { id: "professors", label: "Instructor", icon: Users },
  { id: "rooms", label: "Rooms", icon: DoorOpen },
  { id: "courses", label: "Courses", icon: BookOpen },
  { id: "sections", label: "Sections", icon: GraduationCap },
  { id: "generate", label: "Generate", icon: Zap },
  { id: "timetable", label: "Timetable", icon: Calendar },
];

const helpSteps = [
  "Add Programs, Instructors, Rooms and Courses.",
  "Go to Sections, create a semester (New Semester), then add its sections.",
  "Open Generate and click Generate Schedule.",
  "Open Timetable to review. Click a class to move it to a vacant slot.",
  "Use Change Password to set a new admin password by emailed code.",
];

const templates = [
  {
    name: "Instructors",
    file: "instructors-template.csv",
    note: "One row per instructor per available day. Times are 24-hour (08:00).",
    header: [
      "lname",
      "fname",
      "mname",
      "department",
      "position",
      "username",
      "max_hours_per_day",
      "max_hours_per_week",
      "availability_day",
      "availability_start",
      "availability_end",
    ],
    sample: [
      "Dela Cruz",
      "Juan",
      "M",
      "IT/ENGG",
      "Instructor",
      "jdelacruz",
      "8",
      "30",
      "Monday",
      "08:00",
      "17:00",
    ],
  },
  {
    name: "Courses",
    file: "courses-template.csv",
    note: "One row per course placement. Program name must match exactly.",
    header: [
      "course_code",
      "course_description",
      "course_type",
      "program",
      "year_level",
      "term",
    ],
    sample: [
      "IT101",
      "Introduction to Computing",
      "Lecture",
      "Bachelor of Science in Information Technology",
      "1st Year",
      "1st Semester",
    ],
  },
];

function downloadTemplate(t: (typeof templates)[number]) {
  const csv = [t.header, t.sample]
    .map((r) => r.map((c) => `"${c}"`).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\ufeff" + csv], { type: "text/csv" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = t.file;
  a.click();
  URL.revokeObjectURL(url);
}

export function AppSidebar() {
  const { activeTab, setActiveTab } = useSchedulingStore();
  const navigate = useNavigate();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  function handleLogout() {
    localStorage.removeItem("authToken");
    navigate("/login", { replace: true });
  }
  return (
    <aside className="w-64 h-screen sticky top-0 flex-shrink-0 bg-sidebar text-sidebar-foreground flex flex-col">
      <div className="p-6 border-b border-sidebar-border flex-shrink-0">
        <img
          src="/login-icon.png"
          alt="STI-Sync"
          className="h-14 w-auto rounded-lg"
        />
        <div className="mt-1.5 text-[8.7px] font-medium tracking-[2.2px] text-[#6b7788]">
          AUTOMATED TIMETABLING SYSTEM
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
              activeTab === item.id
                ? "bg-sidebar-accent text-sidebar-primary"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
            )}
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="p-3 border-t border-sidebar-border flex-shrink-0">
        <button
          onClick={() => setShowHelp(true)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/70 transition-all hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        >
          <HelpCircle className="w-4 h-4" />
          Help
        </button>
        <ChangePasswordButton />
        <button
          onClick={() => setConfirmLogout(true)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/70 transition-all hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
      {confirmLogout &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40">
            <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 text-gray-900 shadow-lg">
              <h3 className="font-heading text-lg font-semibold">Log out?</h3>
              <p className="text-sm text-gray-600">
                Are you sure you want to Log out?
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setConfirmLogout(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleLogout}>Log out</Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {showHelp &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40"
            onClick={() => setShowHelp(false)}
          >
            <div
              className="w-full max-w-md max-h-[90vh] overflow-y-auto space-y-4 rounded-xl bg-white p-6 text-gray-900 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="font-heading text-lg font-semibold">
                How to use STI-Sync
              </h3>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-600">
                {helpSteps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3">
                <div>
                  <div className="text-sm font-medium">User Guide</div>
                  <div className="text-xs text-gray-500">
                    Full step-by-step guide with screenshots (PDF).
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    window.open("/STI-Sync_User_Guide.pdf", "_blank")
                  }
                >
                  Open
                </Button>
              </div>
              <div className="space-y-2 border-t pt-4">
                <h4 className="text-sm font-semibold">Import templates</h4>
                {templates.map((t) => (
                  <div
                    key={t.name}
                    className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3"
                  >
                    <div>
                      <div className="text-sm font-medium">{t.name}</div>
                      <div className="text-xs text-gray-500">{t.note}</div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadTemplate(t)}
                    >
                      Download
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <Button onClick={() => setShowHelp(false)}>Close</Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </aside>
  );
}
