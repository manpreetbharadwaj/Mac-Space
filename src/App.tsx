import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { Dashboard } from '@/routes/Dashboard'
import { Scan } from '@/routes/Scan'
import { Cleanup } from '@/routes/Cleanup'
import { Developer } from '@/routes/Developer'
import { Browsers } from '@/routes/Browsers'
import { Applications } from '@/routes/Applications'
import { Files } from '@/routes/Files'
import { Schedule } from '@/routes/Schedule'
import { HistoryPage } from '@/routes/History'
import { SettingsPage } from '@/routes/Settings'
import { Download } from '@/routes/Download'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/cleanup" element={<Cleanup />} />
          <Route path="/developer" element={<Developer />} />
          <Route path="/browsers" element={<Browsers />} />
          <Route path="/applications" element={<Applications />} />
          <Route path="/files" element={<Files />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/download" element={<Download />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
