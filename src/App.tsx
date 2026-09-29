import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import TopNavigationBar from './components/TopNavigationBar';
import PWAInstallPrompt from './components/PWAInstallPrompt';
import SovereignLoadingHUD from './components/SovereignLoadingHUD';
import { ChatProvider } from './context/ChatContext';

// Dynamic Code-Splitting with React 19 Lazy Loading
const ConsolePage = lazy(() => import('./pages/ConsolePage'));
const ChatChamberPage = lazy(() => import('./pages/ChatChamberPage'));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const AgentsPage = lazy(() => import('./pages/AgentsPage'));
const ForgePage = lazy(() => import('./pages/ForgePage'));
const DeveloperPage = lazy(() => import('./pages/DeveloperPage'));
const SentinelPage = lazy(() => import('./pages/SentinelPage'));
const KernelOSPage = lazy(() => import('./pages/KernelOSPage'));
const TestAutomationPage = lazy(() => import('./pages/TestAutomationPage'));
const InputDock = lazy(() => import('./components/capsule/InputDock'));

function InputDockWrapper() {
  return (
    <div className="min-h-screen bg-[#07090e] p-6 pt-10">
      <div className="max-w-4xl mx-auto flex flex-col h-[600px]">
        <InputDock />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ChatProvider>
        {/* Global Highly-Flexible Header Navigation */}
        <TopNavigationBar />

        <Suspense fallback={<SovereignLoadingHUD />}>
          <Routes>
            <Route path="/" element={<ConsolePage />} />
            <Route path="/commander" element={<ConsolePage />} />
            <Route path="/commander/chat" element={<ChatChamberPage />} />
            <Route path="/commander/input" element={<InputDockWrapper />} />
            
            {/* Real Production Pages */}
            <Route path="/commander/approvals" element={<ApprovalsPage />} />
            <Route path="/commander/audit" element={<AuditPage />} />
            <Route path="/commander/tests" element={<TestAutomationPage />} />
            <Route path="/commander/qa" element={<TestAutomationPage />} />
            <Route path="/commander/agents" element={<AgentsPage />} />
            <Route path="/commander/forge" element={<ForgePage />} />
            <Route path="/commander/developer" element={<DeveloperPage />} />
            <Route path="/commander/sentinel" element={<SentinelPage />} />
            <Route path="/commander/kernel" element={<KernelOSPage />} />

            {/* Fallback */}
            <Route path="*" element={<ConsolePage />} />
          </Routes>
        </Suspense>

        {/* In-App PWA Install Banner */}
        <PWAInstallPrompt />
      </ChatProvider>
    </BrowserRouter>
  );
}
