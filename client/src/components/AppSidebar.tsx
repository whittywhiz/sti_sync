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
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSchedulingStore } from "@/store/schedulingStore";
import { cn } from "@/lib/utils";
import ChangePasswordButton from "@/components/ChangePasswordButton";

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "programs", label: "Programs", icon: School },
  { id: "professors", label: "Professors", icon: Users },
  { id: "rooms", label: "Rooms", icon: DoorOpen },
  { id: "courses", label: "Courses", icon: BookOpen },
  { id: "sections", label: "Sections", icon: GraduationCap },
  { id: "generate", label: "Generate", icon: Zap },
  { id: "timetable", label: "Timetable", icon: Calendar },
];

export function AppSidebar() {
  const { activeTab, setActiveTab } = useSchedulingStore();
  const navigate = useNavigate();

  function handleLogout() {
    localStorage.removeItem("authToken");
    navigate("/login", { replace: true });
  }
  return (
    <aside className="w-64 h-screen sticky top-0 flex-shrink-0 bg-sidebar text-sidebar-foreground flex flex-col">
      <div className="p-6 border-b border-sidebar-border flex-shrink-0">
        <img
          src="/sidebarlogo.png"
          alt="STI-Sync"
          className="h-14 w-auto rounded-lg"
        />
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
        <ChangePasswordButton />
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/70 transition-all hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    </aside>
  );
}
