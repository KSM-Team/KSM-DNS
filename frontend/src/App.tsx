import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AuthGuard from '@/components/AuthGuard'
import AppLayout from '@/components/AppLayout'
import Login from '@/pages/login'
import Dashboard from '@/pages/dashboard'
import Domains from '@/pages/domains'
import DomainRecords from '@/pages/domains/records'
import DNSMigrate from '@/pages/migrate'
import Platforms from '@/pages/platforms'
import Topology from '@/pages/topology'
import Failover from '@/pages/failover'
import Scheduler from '@/pages/scheduler'
import SSL from '@/pages/ssl'
import Notifications from '@/pages/notifications'
import Settings from '@/pages/settings'
import Users from '@/pages/users'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<AuthGuard />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/platforms" element={<Platforms />} />
            <Route path="/domains" element={<Domains />} />
            <Route path="/migrate" element={<DNSMigrate />} />
            <Route path="/domains/:id/records" element={<DomainRecords />} />
            <Route path="/topology" element={<Topology />} />
            <Route path="/failover" element={<Failover />} />
            <Route path="/scheduler" element={<Scheduler />} />
            <Route path="/ssl" element={<SSL />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/users" element={<Users />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
