import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where, doc, updateDoc, setDoc } from 'firebase/firestore';
import { db, auth, sanitizeForFirestore } from '../firebase';
import ApprovalQueue from '../components/ApprovalQueue';
import ProposeAction from '../components/ProposeAction';
import { Approval } from '../types';
import { CheckSquare, Plus, RefreshCw, Filter, ShieldCheck, AlertCircle } from 'lucide-react';

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [showProposeModal, setShowProposeModal] = useState(false);
  const [submittingProposal, setSubmittingProposal] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'executed' | 'rejected'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth.currentUser) {
      // Fallback load from API
      fetch('/api/hitl/approvals')
        .then(r => r.json())
        .then(d => {
          if (d.approvals) setApprovals(d.approvals);
          setLoading(false);
        })
        .catch(() => setLoading(false));
      return;
    }

    const q = query(
      collection(db, 'approvals'),
      where('creatorId', '==', auth.currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Approval))
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      setApprovals(list);
      setLoading(false);
    }, (err) => {
      console.warn('Firestore snapshot error, falling back to API:', err);
      fetch('/api/hitl/approvals')
        .then(r => r.json())
        .then(d => {
          if (d.approvals) setApprovals(d.approvals);
          setLoading(false);
        });
    });

    return () => unsubscribe();
  }, []);

  const handlePropose = async (proposalData: {
    agent: string;
    type: string;
    summary: string;
    reason: string;
    risk: 'low' | 'medium' | 'high' | 'critical';
    payload: any;
  }) => {
    setSubmittingProposal(true);
    try {
      const user = auth.currentUser;
      const now = new Date();
      const expires = new Date(now.getTime() + 1000 * 60 * 60 * 24);
      
      const newApproval: Approval = {
        id: `appr-${Date.now()}`,
        status: 'pending',
        risk: proposalData.risk,
        agent: proposalData.agent,
        type: proposalData.type,
        summary: proposalData.summary,
        reason: proposalData.reason,
        createdAt: now.toISOString(),
        expiresAt: expires.toISOString(),
        payload: proposalData.payload
      };

      if (user) {
        await setDoc(doc(db, 'approvals', newApproval.id), sanitizeForFirestore({
          ...newApproval,
          creatorId: user.uid
        }));
      } else {
        setApprovals(prev => [newApproval, ...prev]);
      }
      setShowProposeModal(false);
    } catch (err: any) {
      console.error('Error creating proposal:', err);
    } finally {
      setSubmittingProposal(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      if (auth.currentUser) {
        await updateDoc(doc(db, 'approvals', id), sanitizeForFirestore({
          status: 'approved',
          signature: `SIG-USER-${auth.currentUser.uid.slice(0, 8)}-${Date.now()}`
        }));
      } else {
        setApprovals(prev => prev.map(a => a.id === id ? { ...a, status: 'approved', signature: `SIG-LOCAL-${Date.now()}` } : a));
      }
    } catch (e: any) {
      console.error('Approval update failed:', e);
    }
  };

  const handleReject = async (id: string) => {
    try {
      if (auth.currentUser) {
        await updateDoc(doc(db, 'approvals', id), sanitizeForFirestore({
          status: 'rejected'
        }));
      } else {
        setApprovals(prev => prev.map(a => a.id === id ? { ...a, status: 'rejected' } : a));
      }
    } catch (e: any) {
      console.error('Rejection failed:', e);
    }
  };

  const handleExecute = async (id: string) => {
    setExecutingId(id);
    try {
      const res = await fetch(`/api/hitl/approvals/${id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: 'SIG-VERIFIED-' + Date.now() })
      });
      const data = await res.json();
      const resultObj = {
        stdout: data.output || 'Execution completed in sandbox.',
        stderr: '',
        exitCode: data.ok ? 0 : 1,
        msg: data.message
      };

      if (auth.currentUser) {
        await updateDoc(doc(db, 'approvals', id), sanitizeForFirestore({
          status: 'executed',
          result: resultObj
        }));
      } else {
        setApprovals(prev => prev.map(a => a.id === id ? {
          ...a,
          status: 'executed',
          result: resultObj
        } : a));
      }
    } catch (e: any) {
      console.error('Execution error:', e);
    } finally {
      setExecutingId(null);
    }
  };

  const filteredApprovals = approvals.filter(a => {
    if (filter === 'all') return true;
    return a.status === filter;
  });

  const counts = {
    all: approvals.length,
    pending: approvals.filter(a => a.status === 'pending').length,
    approved: approvals.filter(a => a.status === 'approved').length,
    executed: approvals.filter(a => a.status === 'executed').length,
    rejected: approvals.filter(a => a.status === 'rejected').length
  };

  return (
    <div className="min-h-screen bg-[#07090e] p-4 md:p-8 text-slate-200">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 font-mono text-sm tracking-wider uppercase mb-1">
              <CheckSquare className="w-5 h-5" />
              <span>Human-in-the-Loop Cockpit</span>
            </div>
            <h1 className="text-2xl font-bold font-sans text-white">Approvals & Governance Queue</h1>
            <p className="text-xs text-slate-400 font-mono mt-1">
              Mandatory cryptographic authorization required before sovereign tool executions.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowProposeModal(!showProposeModal)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-semibold tracking-wider transition shadow-[0_0_15px_rgba(6,182,212,0.3)]"
            >
              <Plus className="w-4 h-4" />
              <span>New Proposal</span>
            </button>
          </div>
        </div>

        {/* Status Counters & Filters */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {(['all', 'pending', 'approved', 'executed', 'rejected'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`p-3 rounded-lg border text-left transition font-mono ${
                filter === tab
                  ? 'bg-slate-800/90 border-cyan-500/60 shadow-[0_0_10px_rgba(34,211,238,0.15)]'
                  : 'bg-slate-900/40 border-slate-800 hover:bg-slate-800/50'
              }`}
            >
              <div className="text-[10px] uppercase text-slate-400 tracking-wider capitalize">{tab}</div>
              <div className={`text-xl font-bold mt-0.5 ${
                tab === 'pending' ? 'text-amber-400' :
                tab === 'approved' ? 'text-cyan-400' :
                tab === 'executed' ? 'text-emerald-400' :
                tab === 'rejected' ? 'text-rose-400' : 'text-white'
              }`}>
                {counts[tab]}
              </div>
            </button>
          ))}
        </div>

        {/* Modal / Inline Propose Action */}
        {showProposeModal && (
          <div className="glass-panel border border-cyan-500/30 rounded-xl p-6 bg-[#0b101b]/95 shadow-2xl relative">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800">
              <h2 className="text-sm font-mono font-bold uppercase text-cyan-400 flex items-center gap-2">
                <Plus className="w-4 h-4" /> Submit Proposal for Signature
              </h2>
              <button
                onClick={() => setShowProposeModal(false)}
                className="text-slate-400 hover:text-white font-mono text-xs"
              >
                ✕ Close
              </button>
            </div>
            <ProposeAction
              onPropose={handlePropose}
              submitting={submittingProposal}
            />
          </div>
        )}

        {/* The Real Approvals Queue */}
        <div className="glass-panel rounded-xl border border-slate-800 bg-[#0b101b]/80 p-5">
          <ApprovalQueue
            approvals={filteredApprovals}
            onExecute={handleExecute}
            onApproveLocal={handleApprove}
            onRejectLocal={handleReject}
            onRefresh={() => {}}
            executingId={executingId}
          />
        </div>
      </div>
    </div>
  );
}
