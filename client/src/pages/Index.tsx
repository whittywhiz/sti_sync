import { AppSidebar } from "@/components/AppSidebar";
import { DashboardView } from "@/components/DashboardView";
import { ProgramsView } from "@/components/ProgramsView";
import { ProfessorsView } from "@/components/ProfessorsView";
import { RoomsView } from "@/components/RoomsView";
import { CoursesView } from "@/components/CoursesView";
import { SectionsView } from "@/components/SectionsView";
import { GenerateView } from "@/components/GenerateView";
import { TimetableView } from "@/components/TimetableView";
import { useSchedulingStore } from "@/store/schedulingStore";

const views: Record<string, React.FC> = {
  dashboard: DashboardView,
  programs: ProgramsView,
  professors: ProfessorsView,
  rooms: RoomsView,
  courses: CoursesView,
  sections: SectionsView,
  generate: GenerateView,
  timetable: TimetableView,
};

export default function Index() {
  const { activeTab } = useSchedulingStore();
  const ActiveView = views[activeTab] || DashboardView;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[1500px] mx-auto p-8">
          <ActiveView />
        </div>
      </main>
    </div>
  );
}
