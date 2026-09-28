import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ConsolePage from './pages/ConsolePage';
import ChatChamberPage from './pages/ChatChamberPage';
import ApprovalsPage from './pages/ApprovalsPage';
import AuditPage from './pages/AuditPage';
import AgentsPage from './pages/AgentsPage';
import ForgePage from './pages/ForgePage';
import DeveloperPage from './pages/DeveloperPage';
import SentinelPage from './pages/SentinelPage';
import KernelOSPage from './pages/KernelOSPage';
import TestAutomationPage from './pages/TestAutomationPage';
import InputDock from './components/capsule/InputDock';
import PWAInstallPrompt from './components/PWAInstallPrompt';
import TopNavigationBar from './components/TopNavigationBar';
import { ChatProvider } from './context/ChatContext';

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

        {/* In-App PWA Install Banner */}
        <PWAInstallPrompt />
      </ChatProvider>
    </BrowserRouter>
  );
}
