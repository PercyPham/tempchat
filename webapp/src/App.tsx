import { Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { HotelProvider } from "./context/HotelContext";
import { AppShell } from "./components/layout/AppShell";
import { Spinner } from "./components/shared/Spinner";
import { DashboardPage } from "./pages/DashboardPage";
import { CreateRoomPage } from "./pages/CreateRoomPage";
import { InvitePage } from "./pages/InvitePage";
import { JoinPage } from "./pages/JoinPage";
import { ChatPage } from "./pages/ChatPage";

export default function App() {
  return (
    <ThemeProvider>
    <BrowserRouter>
      <AppShell>
        <Suspense
          fallback={
            <div className="flex h-screen items-center justify-center">
              <Spinner size={32} />
            </div>
          }
        >
          <HotelProvider>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/create" element={<CreateRoomPage />} />
              <Route path="/invite/:roomId" element={<InvitePage />} />
              <Route path="/join/:roomId" element={<JoinPage />} />
              <Route path="/chat/:roomId" element={<ChatPage />} />
            </Routes>
          </HotelProvider>
        </Suspense>
      </AppShell>
    </BrowserRouter>
    </ThemeProvider>
  );
}
