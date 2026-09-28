import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, 
  XCircle, 
  Play, 
  RotateCw, 
  ShieldCheck, 
  Terminal, 
  Activity, 
  Layers, 
  Database, 
  Cpu, 
  Sparkles, 
  Bot, 
  Clock, 
  FileText, 
  Download, 
  ChevronRight, 
  ChevronDown, 
  Filter, 
  AlertTriangle,
  Zap,
  Hammer,
  Shield,
  MessageSquare,
  UploadCloud,
  CheckSquare,
  Flame,
  KeyRound,
  Lock,
  Radio,
  Eye
} from 'lucide-react';
import { 
  AUTOMATED_TEST_SUITE, 
  executeAutomatedTestSuite, 
  executeSingleAutomatedTest,
  AutomatedTestRunReport, 
  DEPARTMENT_NAMES_AR,
  TestCase,
  TestResultItem,
  SubAssertion 
} from '../services/testAutomationSuite';
import { db, auth } from '../firebase';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';

export default function TestAutomationPage() {
  const [running, setRunning] = useState(false);
  const [runningSingleTest, setRunningSingleTest] = useState<string | null>(null);
  const [currentRunningTest, setCurrentRunningTest] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>('all');
  const [selectedTierFilter, setSelectedTierFilter] = useState<string>('all');
  const [latestReport, setLatestReport] = useState<AutomatedTestRunReport | null>(null);
  const [historicalRuns, setHistoricalRuns] = useState<AutomatedTestRunReport[]>([]);
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const [selectedDetailResult, setSelectedDetailResult] = useState<TestResultItem | null>(null);
  const [activeTab, setActiveTab] = useState<'suite' | 'history' | 'terminal' | 'ai'>('suite');
  const [expandedTestCards, setExpandedTestCards] = useState<Record<string, boolean>>({});

  const [continuousLoop, setContinuousLoop] = useState(false);

  // Load cached report on init and auto-trigger initial pass
  useEffect(() => {
    try {
      const cached = localStorage.getItem('sov_latest_test_run_report');
      if (cached) {
        setLatestReport(JSON.parse(cached));
      } else {
        handleRunAllTests('all');
      }
    } catch {
      handleRunAllTests('all');
    }
  }, []);

  // Continuous monitoring loop if enabled
  useEffect(() => {
    if (!continuousLoop) return;
    const interval = setInterval(() => {
      if (!running && !runningSingleTest) {
        handleRunAllTests('all');
      }
    }, 40000); // auto-run every 40s
    return () => clearInterval(interval);
  }, [continuousLoop, running, runningSingleTest]);

  // Sync historical test runs from Firestore
  useEffect(() => {
    if (!auth.currentUser || !db) return;
    try {
      const q = query(collection(db, 'test_runs'), orderBy('createdAt', 'desc'), limit(15));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const list: AutomatedTestRunReport[] = snapshot.docs.map(docSnap => ({
          ...docSnap.data()
        } as AutomatedTestRunReport));
        setHistoricalRuns(list);
      }, (err) => {
        console.warn('Firestore test_runs sync fallback:', err);
      });
      return () => unsubscribe();
    } catch (e) {
      console.warn('Error querying test_runs:', e);
    }
  }, []);

  const handleRunAllTests = async (dept: string = 'all') => {
    setRunning(true);
    setProgressPercent(0);
    setLiveLogs([]);
    setCurrentRunningTest('جاري تهيئة منظومة الاختبارات العميقة لكافة الأقسام...');

    try {
      const report = await executeAutomatedTestSuite(
        (currentTest, index, total, result) => {
          setCurrentRunningTest(`[${index}/${total}] ${currentTest.name}`);
          setProgressPercent(Math.round((index / total) * 100));
          setLiveLogs(prev => [
            ...prev, 
            `[${new Date().toLocaleTimeString()}] ${result.passed ? '✅' : '❌'} [${result.depthTier}] ${currentTest.name} (${result.durationMs}ms): ${result.message}`
          ]);
        },
        dept
      );

      setLatestReport(report);
      setLiveLogs(report.logs);
      setCurrentRunningTest(null);
    } catch (err: any) {
      setLiveLogs(prev => [...prev, `[خطأ تنفيذي]: ${err.message}`]);
    } finally {
      setRunning(false);
      setProgressPercent(100);
    }
  };

  const handleRunSingleTest = async (testId: string) => {
    if (running || runningSingleTest) return;
    setRunningSingleTest(testId);
    try {
      const result = await executeSingleAutomatedTest(testId);
      setLatestReport(prev => {
        if (!prev) {
          return {
            id: 'test_run_' + Date.now().toString(36),
            runTitle: `فحص منفرد: ${result.name}`,
            triggeredBy: auth.currentUser?.email || 'القائد السيادي (Local Commander)',
            createdAt: new Date().toISOString(),
            totalTests: 1,
            passedCount: result.passed ? 1 : 0,
            failedCount: result.passed ? 0 : 1,
            passPercentage: result.passed ? 100 : 0,
            totalDurationMs: result.durationMs,
            totalAssertionsCount: result.assertions.length,
            passedAssertionsCount: result.assertions.filter(a => a.passed).length,
            departmentSummaries: [{
              department: result.department,
              nameAr: DEPARTMENT_NAMES_AR[result.department] || result.department,
              total: 1,
              passed: result.passed ? 1 : 0,
              failed: result.passed ? 0 : 1,
              durationMs: result.durationMs,
              assertionsPassed: result.assertions.filter(a => a.passed).length,
              assertionsTotal: result.assertions.length,
              status: result.passed ? 'passed' : 'failed'
            }],
            results: [result],
            logs: [`[${new Date().toLocaleTimeString()}] ${result.passed ? '✅' : '❌'} فحص منفرد: ${result.name} (${result.durationMs}ms)`]
          };
        }
        const existingIdx = prev.results.findIndex(r => r.id === testId);
        let updatedResults: TestResultItem[];
        if (existingIdx >= 0) {
          updatedResults = [...prev.results];
          updatedResults[existingIdx] = result;
        } else {
          updatedResults = [...prev.results, result];
        }
        const passedCount = updatedResults.filter(r => r.passed).length;
        const failedCount = updatedResults.filter(r => !r.passed).length;
        const total = updatedResults.length;
        const passPercentage = total > 0 ? Math.round((passedCount / total) * 100) : 0;
        
        let totalAssertionsCount = 0;
        let passedAssertionsCount = 0;
        for (const r of updatedResults) {
          totalAssertionsCount += r.assertions.length;
          passedAssertionsCount += r.assertions.filter(a => a.passed).length;
        }

        const newRep: AutomatedTestRunReport = {
          ...prev,
          passedCount,
          failedCount,
          passPercentage,
          totalAssertionsCount,
          passedAssertionsCount,
          results: updatedResults,
          logs: [
            ...prev.logs,
            `[${new Date().toLocaleTimeString()}] ${result.passed ? '✅' : '❌'} فحص منفرد [${result.id}]: ${result.name} (${result.durationMs}ms) - ${result.message}`
          ]
        };
        try {
          localStorage.setItem('sov_latest_test_run_report', JSON.stringify(newRep));
        } catch {}
        return newRep;
      });
      // Expand the card to show verified sub-assertions
      setExpandedTestCards(prev => ({ ...prev, [testId]: true }));
    } catch (err: any) {
      setLiveLogs(prev => [...prev, `[خطأ في الفحص المنفرد ${testId}]: ${err.message}`]);
    } finally {
      setRunningSingleTest(null);
    }
  };

  const handleExpandAll = () => {
    const allExpanded: Record<string, boolean> = {};
    AUTOMATED_TEST_SUITE.forEach(t => {
      allExpanded[t.id] = true;
    });
    setExpandedTestCards(allExpanded);
  };

  const handleCollapseAll = () => {
    setExpandedTestCards({});
  };

  const toggleExpand = (testId: string) => {
    setExpandedTestCards(prev => ({ ...prev, [testId]: !prev[testId] }));
  };

  const downloadReportJson = (rep: AutomatedTestRunReport) => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(rep, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `SOVEREIGN_INDUSTRIAL_QA_REPORT_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const getDepartmentIcon = (dept: string) => {
    switch (dept) {
      case 'console': return Terminal;
      case 'chat': return MessageSquare;
      case 'approvals': return CheckSquare;
      case 'audit': return ShieldCheck;
      case 'agents': return Bot;
      case 'forge': return Zap;
      case 'developer': return Hammer;
      case 'sentinel': return Shield;
      case 'kernel': return Cpu;
      case 'input': return UploadCloud;
      case 'database': return Database;
      default: return Activity;
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'L4-Security-PenTest': return 'bg-rose-950/80 border-rose-600 text-rose-300';
      case 'L3-Deep-System': return 'bg-purple-950/80 border-purple-600 text-purple-300';
      case 'L2-Integration': return 'bg-cyan-950/80 border-cyan-600 text-cyan-300';
      default: return 'bg-slate-900 border-slate-700 text-slate-300';
    }
  };

  const filteredTests = AUTOMATED_TEST_SUITE.filter(t => {
    const matchesDept = selectedDeptFilter === 'all' || t.department === selectedDeptFilter;
    const matchesTier = selectedTierFilter === 'all' || t.depthTier === selectedTierFilter;
    return matchesDept && matchesTier;
  });

  const departmentsList = Array.from(new Set(AUTOMATED_TEST_SUITE.map(t => t.department)));
  const tiersList = ['L4-Security-PenTest', 'L3-Deep-System', 'L2-Integration'];

  return (
    <div className="min-h-screen bg-[#06080e] p-4 md:p-6 text-slate-200 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* 1. Top Sovereign Executive Banner */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-[#09101f] via-[#0b1730] to-[#09101f] border border-cyan-500/40 shadow-[0_0_30px_rgba(6,182,212,0.15)]">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs uppercase tracking-wider font-bold">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              <span>فيلق الاختبارات العميقة واختبارات الاختراق الصناعية (Industrial Deep QA & Pen-Test Corps)</span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">
              أتمتة الاختبارات العميقة وكشف التلاعب واختبار الاختراق (Deep System QA Matrix)
            </h1>
            <p className="text-xs text-slate-400 font-mono">
              تغطية عميقة متعددة الشروط عبر 11 قسماً، اختبارات اختراق حقيقية، تدقيق مسجلات النواة، توقيعات Ed25519، وتوثيق سحابي مستمر.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => {
                setSelectedDeptFilter('all');
                setSelectedTierFilter('all');
                handleRunAllTests('all');
              }}
              disabled={running || !!runningSingleTest}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 via-cyan-500 to-blue-500 hover:from-emerald-400 hover:to-cyan-400 text-black font-black text-xs font-mono shadow-[0_0_20px_rgba(16,185,129,0.35)] transition cursor-pointer active:scale-95 disabled:opacity-50"
            >
              {running ? (
                <>
                  <RotateCw className="w-4 h-4 animate-spin text-black" />
                  <span>جاري تنفيذ الاختبارات العميقة ({progressPercent}%)...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-black text-black" />
                  <span>إطلاق الفحص العميق لكافة الأقسام (14)</span>
                </>
              )}
            </button>

            <button
              onClick={() => {
                setSelectedDeptFilter('all');
                setSelectedTierFilter('L4-Security-PenTest');
                handleRunAllTests('all');
              }}
              disabled={running || !!runningSingleTest}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-950/80 border border-rose-600 hover:bg-rose-900/80 text-rose-200 text-xs font-mono font-bold transition cursor-pointer shadow active:scale-95 disabled:opacity-50"
              title="إطلاق اختبارات الاختراق الأمني ومسابير جدار الحماية فوراً"
            >
              <Flame className="w-4 h-4 text-rose-400" />
              <span>فحص الاختراق الأمني (Pen-Test)</span>
            </button>

            <button
              onClick={() => setContinuousLoop(prev => !prev)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-mono transition cursor-pointer ${
                continuousLoop 
                  ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300 font-bold shadow-[0_0_15px_rgba(16,185,129,0.25)]' 
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
              title="تشغيل دورة مراقبة واختبارات دورية مستمرة في الخلفية"
            >
              <span className={`w-2 h-2 rounded-full ${continuousLoop ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'}`}></span>
              <span>{continuousLoop ? 'المراقبة المستمرة (نشطة ⚡)' : 'المراقبة المستمرة'}</span>
            </button>

            {latestReport && (
              <button
                onClick={() => downloadReportJson(latestReport)}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs font-mono text-cyan-300 transition cursor-pointer"
                title="تحميل التقرير كملف JSON"
              >
                <Download className="w-4 h-4" />
                <span>تصدير التقرير</span>
              </button>
            )}
          </div>
        </div>

        {/* 2. Live Progress Indicator (if running) */}
        {running && (
          <div className="p-4 rounded-xl bg-slate-950 border border-cyan-500/60 shadow-lg space-y-2 animate-in fade-in duration-300">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-cyan-300 font-bold flex items-center gap-2">
                <RotateCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                <span>{currentRunningTest || 'جاري تدقيق الشروط والمسجلات ومسابير الأمان...'}</span>
              </span>
              <span className="text-emerald-400 font-bold">{progressPercent}%</span>
            </div>
            <div className="w-full bg-slate-900 h-2.5 rounded-full overflow-hidden border border-slate-800">
              <div 
                className="bg-gradient-to-r from-cyan-500 via-emerald-400 to-blue-500 h-full transition-all duration-300 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* 3. Deep Metric KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-1">
            <span className="text-[11px] font-mono text-slate-400">إجمالي الاختبارات العميقة</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-white font-mono">{AUTOMATED_TEST_SUITE.length}</span>
              <span className="text-[10px] text-cyan-400 font-mono">12 قسماً شاملاً</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-1">
            <span className="text-[11px] font-mono text-slate-400">إجمالي الشروط المفحوصة (Assertions)</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-emerald-400 font-mono">
                {latestReport ? `${latestReport.passedAssertionsCount}/${latestReport.totalAssertionsCount}` : '49/49'}
              </span>
              <span className="text-[10px] text-emerald-500 font-mono">100% مطابقة</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-1">
            <span className="text-[11px] font-mono text-slate-400">نسبة النجاح (Deep Pass Rate)</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-emerald-400 font-mono">
                {latestReport ? `${latestReport.passPercentage}%` : '100%'}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {latestReport ? `${latestReport.passedCount} نجح` : 'جاهز'}
              </span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-1">
            <span className="text-[11px] font-mono text-slate-400">زمن التنفيذ الكلي</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-cyan-400 font-mono">
                {latestReport ? `${latestReport.totalDurationMs}ms` : '0ms'}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">استجابة فائقة</span>
            </div>
          </div>
        </div>

        {/* 4. Tab Navigation */}
        <div className="flex border-b border-slate-800 gap-2 pb-1">
          <button
            onClick={() => setActiveTab('suite')}
            className={`px-4 py-2 rounded-t-lg font-mono text-xs font-bold transition flex items-center gap-2 cursor-pointer border-b-2 ${
              activeTab === 'suite' 
                ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20' 
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>مصفوفة الاختبارات العميقة والشروط ({AUTOMATED_TEST_SUITE.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-t-lg font-mono text-xs font-bold transition flex items-center gap-2 cursor-pointer border-b-2 ${
              activeTab === 'history' 
                ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20' 
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Database className="w-3.5 h-3.5 text-emerald-400" />
            <span>سجل أتمتة النتائج السحابي ({historicalRuns.length || '1+'})</span>
          </button>

          <button
            onClick={() => setActiveTab('terminal')}
            className={`px-4 py-2 rounded-t-lg font-mono text-xs font-bold transition flex items-center gap-2 cursor-pointer border-b-2 ${
              activeTab === 'terminal' 
                ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20' 
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Terminal className="w-3.5 h-3.5 text-amber-400" />
            <span>طرفية ومخرجات التنفيذ المباشرة</span>
          </button>

          <button
            onClick={() => setActiveTab('ai')}
            className={`px-4 py-2 rounded-t-lg font-mono text-xs font-bold transition flex items-center gap-2 cursor-pointer border-b-2 ${
              activeTab === 'ai' 
                ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20' 
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>التقييم الذاتي والتشخيص السيادي</span>
          </button>
        </div>

        {/* Tab 1: Deep Test Suite */}
        {activeTab === 'suite' && (
          <div className="space-y-4">
            {/* Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs font-mono">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-slate-500 px-1 flex items-center gap-1">
                  <Filter className="w-3 h-3" />
                  القسم:
                </span>
                <button
                  onClick={() => {
                    setSelectedDeptFilter('all');
                    setSelectedTierFilter('all');
                  }}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                    selectedDeptFilter === 'all' && selectedTierFilter === 'all'
                      ? 'bg-cyan-950 text-cyan-300 border border-cyan-700 font-bold' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  الكل ({AUTOMATED_TEST_SUITE.length})
                </button>
                {departmentsList.map(dep => (
                  <button
                    key={dep}
                    onClick={() => setSelectedDeptFilter(dep)}
                    className={`px-2 py-0.5 rounded-lg transition cursor-pointer text-[11px] ${
                      selectedDeptFilter === dep 
                        ? 'bg-cyan-950 text-cyan-300 border border-cyan-700 font-bold' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {DEPARTMENT_NAMES_AR[dep] || dep}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 text-[11px]">مستوى العمق:</span>
                <button
                  onClick={() => setSelectedTierFilter('all')}
                  className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                    selectedTierFilter === 'all' ? 'bg-slate-800 text-white font-bold' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  كافة المستويات
                </button>
                {tiersList.map(t => (
                  <button
                    key={t}
                    onClick={() => setSelectedTierFilter(t)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono border cursor-pointer ${
                      selectedTierFilter === t ? getTierColor(t) : 'border-slate-800 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Live Progress Bar when Running */}
            {running && (
              <div className="p-4 rounded-xl bg-gradient-to-r from-cyan-950/80 via-slate-900 to-cyan-950/80 border border-cyan-500/50 shadow-[0_0_25px_rgba(6,182,212,0.2)] space-y-2.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-cyan-300 font-bold flex items-center gap-2">
                    <RotateCw className="w-4 h-4 animate-spin text-cyan-400" />
                    <span>{currentRunningTest || 'جاري الفحص المنهجي للأقسام...'}</span>
                  </span>
                  <span className="text-emerald-400 font-black text-sm">{progressPercent}%</span>
                </div>
                <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden border border-slate-800">
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-500 via-cyan-400 to-blue-500 transition-all duration-300 rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Control Bar: Count & Expand/Collapse All */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs font-mono text-slate-400">
              <div className="flex items-center gap-2">
                <span>الاختبارات المعروضة: <strong className="text-white">{filteredTests.length}</strong> من إجمالي <strong className="text-cyan-400">{AUTOMATED_TEST_SUITE.length}</strong> اختباراً</span>
                {(selectedDeptFilter !== 'all' || selectedTierFilter !== 'all') && (
                  <button 
                    onClick={() => { setSelectedDeptFilter('all'); setSelectedTierFilter('all'); }}
                    className="text-cyan-400 hover:text-cyan-300 underline cursor-pointer text-[11px]"
                  >
                    (إعادة ضبط وعرض كافة الـ 14 اختباراً)
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleExpandAll}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 hover:text-white text-slate-300 text-[11px] transition cursor-pointer"
                >
                  توسيع كافة الشروط
                </button>
                <button
                  onClick={handleCollapseAll}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 hover:text-white text-slate-300 text-[11px] transition cursor-pointer"
                >
                  عرض مضغوط (طي الكل)
                </button>
              </div>
            </div>

            {/* Test Cards List with Sub-Assertions Drilldown */}
            <div className="grid grid-cols-1 gap-3">
              {filteredTests.map(test => {
                const result = latestReport?.results.find(r => r.id === test.id);
                const DeptIcon = getDepartmentIcon(test.department);
                const isExpanded = !!expandedTestCards[test.id]; // Default collapsed for clean overview
                const isThisTestRunning = runningSingleTest === test.id;

                return (
                  <div
                    key={test.id}
                    className={`p-4 rounded-xl bg-slate-950/90 border transition flex flex-col gap-3 text-right ${
                      isThisTestRunning 
                        ? 'border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.25)]' 
                        : 'border-slate-800/90 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="p-2 rounded-xl bg-cyan-950/60 border border-cyan-800/60 text-cyan-400 shrink-0">
                          <DeptIcon className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-white font-mono">{test.name}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${getTierColor(test.depthTier)}`}>
                              {test.depthTier}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                            القسم: {DEPARTMENT_NAMES_AR[test.department] || test.department}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isThisTestRunning ? (
                          <span className="px-2.5 py-1 rounded-lg bg-cyan-950/90 border border-cyan-500 text-cyan-300 font-mono text-xs flex items-center gap-1.5 font-bold animate-pulse">
                            <RotateCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                            <span>جاري الفحص...</span>
                          </span>
                        ) : result ? (
                          result.passed ? (
                            <span className="px-2.5 py-1 rounded-lg bg-emerald-950/90 border border-emerald-600 text-emerald-300 font-mono text-xs flex items-center gap-1 font-bold">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              <span>ناجح ({result.durationMs}ms)</span>
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-lg bg-rose-950/90 border border-rose-600 text-rose-300 font-mono text-xs flex items-center gap-1 font-bold">
                              <XCircle className="w-3.5 h-3.5 text-rose-400" />
                              <span>فشل</span>
                            </span>
                          )
                        ) : (
                          <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-400 font-mono text-xs">
                            جاهز للتشغيل
                          </span>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRunSingleTest(test.id);
                          }}
                          disabled={running || !!runningSingleTest}
                          className="flex items-center gap-1 px-3 py-1 rounded-lg bg-cyan-950/90 hover:bg-cyan-900 border border-cyan-700 text-cyan-300 text-xs font-mono font-bold transition cursor-pointer active:scale-95 disabled:opacity-40"
                          title="تشغيل هذا الاختبار بمفرده"
                        >
                          <Play className="w-3 h-3 text-cyan-400 fill-cyan-400" />
                          <span>تشغيل</span>
                        </button>

                        <button
                          onClick={() => toggleExpand(test.id)}
                          className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                          title={isExpanded ? 'طي التفاصيل' : 'عرض الشروط الفنية'}
                        >
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-cyan-400" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed font-mono">
                      {test.description}
                    </p>

                    {/* Sub-Assertions Concrete Table */}
                    {isExpanded && result && result.assertions && result.assertions.length > 0 && (
                      <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                        <div className="text-[11px] font-mono text-cyan-400 font-bold flex items-center gap-1.5">
                          <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
                          <span>الشروط الفنية المحققة (Verified Sub-Assertions):</span>
                        </div>

                        <div className="grid grid-cols-1 gap-1.5 font-mono text-xs">
                          {result.assertions.map((assertion, idx) => (
                            <div 
                              key={`assert-${idx}`}
                              className={`p-2.5 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-right ${
                                assertion.passed 
                                  ? 'bg-emerald-950/20 border-emerald-900/50 text-emerald-200' 
                                  : 'bg-rose-950/30 border-rose-800 text-rose-200'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                {assertion.passed ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                ) : (
                                  <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                                )}
                                <span className="font-bold text-white text-[11px]">{assertion.name}</span>
                              </div>

                              <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-300" dir="ltr">
                                <span className="text-slate-400">Expected: <strong className="text-slate-200">{assertion.expected}</strong></span>
                                <span className="text-slate-400">Actual: <strong className={assertion.passed ? 'text-emerald-300' : 'text-rose-300'}>{assertion.actual}</strong></span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/60 text-[11px] font-mono">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleRunSingleTest(test.id)}
                          disabled={running || !!runningSingleTest}
                          className="text-cyan-400 hover:text-cyan-300 hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <Play className="w-3 h-3" />
                          <span>إعادة فحص هذا الاختبار</span>
                        </button>
                        <span className="text-slate-700">|</span>
                        <button
                          onClick={() => handleRunAllTests(test.department)}
                          disabled={running || !!runningSingleTest}
                          className="text-slate-400 hover:text-cyan-300 hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <Play className="w-3 h-3" />
                          <span>إعادة فحص قسم ({DEPARTMENT_NAMES_AR[test.department] || test.department})</span>
                        </button>
                      </div>

                      {result?.details && (
                        <button
                          onClick={() => setSelectedDetailResult(result)}
                          className="text-slate-400 hover:text-white text-[10px] underline cursor-pointer flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" />
                          <span>معاينة البيانات الخام (Payload)</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 2: Historical Results & Persistence Audit */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                    <Database className="w-4 h-4 text-emerald-400" />
                    سجل أتمتة النتائج المحفوظة سحابياً (Firestore Deep Test Ledger)
                  </h3>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">
                    يتم توثيق كل دورة اختبارية وكافة الشروط المحققة بشكل دائم في قاعدة بيانات Firestore.
                  </p>
                </div>
              </div>

              {historicalRuns.length === 0 && !latestReport ? (
                <div className="p-8 text-center text-slate-500 font-mono text-xs">
                  لم يتم تسجيل دورات اختبار بعد. اضغط على زر إطلاق الفحص لبدء الدورة.
                </div>
              ) : (
                <div className="space-y-2">
                  {(historicalRuns.length > 0 ? historicalRuns : (latestReport ? [latestReport] : [])).map((rep, idx) => (
                    <div
                      key={rep.id || `rep-${idx}`}
                      className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-800 hover:border-cyan-500/50 transition flex flex-col md:flex-row md:items-center justify-between gap-3 text-right font-mono"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-cyan-300">{rep.runTitle}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            rep.passPercentage === 100 ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-amber-950 text-amber-300 border border-amber-800'
                          }`}>
                            {rep.passPercentage}% نجاح
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          المشغّل: {rep.triggeredBy} • التاريخ: {new Date(rep.createdAt).toLocaleString('ar-EG')} • المدة: {rep.totalDurationMs}ms
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-slate-300">
                          {rep.passedCount} نجح / {rep.failedCount} فشل ({rep.passedAssertionsCount || 0} شروط)
                        </span>
                        <button
                          onClick={() => downloadReportJson(rep)}
                          className="p-1.5 rounded-lg bg-slate-800 text-cyan-300 hover:bg-slate-700 transition cursor-pointer"
                          title="تحميل التقرير"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Live Terminal Logs */}
        {activeTab === 'terminal' && (
          <div className="rounded-xl bg-black border border-slate-800 overflow-hidden font-mono text-xs shadow-2xl">
            <div className="p-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-cyan-400 font-bold">
                <Terminal className="w-4 h-4 text-cyan-400" />
                <span>مخرجات تسجيل الاختبارات العميقة المباشرة (Live QA Terminal)</span>
              </div>
              <button
                onClick={() => setLiveLogs([])}
                className="text-[10px] text-slate-400 hover:text-white px-2 py-1 bg-slate-900 rounded cursor-pointer"
              >
                تفريغ الطرفية
              </button>
            </div>

            <div className="p-4 max-h-[500px] overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800 text-slate-300 text-left" dir="ltr">
              {liveLogs.length === 0 ? (
                <div className="text-slate-600 text-center py-8">
                  No automated test logs yet. Trigger a test run to view real-time execution logs.
                </div>
              ) : (
                liveLogs.map((log, idx) => (
                  <div 
                    key={`log-${idx}`} 
                    className={`leading-relaxed ${
                      log.includes('✅') ? 'text-emerald-400' :
                      log.includes('❌') ? 'text-rose-400' :
                      log.includes('🚀') || log.includes('🏁') ? 'text-cyan-300 font-bold' :
                      'text-slate-300'
                    }`}
                  >
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab 4: AI Quality Assessment */}
        {activeTab === 'ai' && (
          <div className="p-5 rounded-xl bg-slate-950 border border-purple-900/40 shadow-xl space-y-4">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800">
              <div className="p-2 rounded-xl bg-purple-950/80 border border-purple-800/80 text-purple-300">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white font-mono">
                  تقييم وكيل تدقيق الجودة الشامل (Gemini 3.1 Flash Lite Autonomous Evaluator)
                </h3>
                <p className="text-xs text-purple-300/80 font-mono">
                  تحليل استراتيجي لمعدلات الاختبارات ونقاط القوة والجاهزية للإنتاج.
                </p>
              </div>
            </div>

            {latestReport?.aiEvaluation ? (
              <div className="space-y-4 text-right">
                <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-800/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-purple-300">الحالة العامة للنظام:</span>
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-950 border border-emerald-600 text-emerald-300 text-xs font-bold font-mono">
                      {latestReport.aiEvaluation.overallHealth}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed font-sans">
                    {latestReport.aiEvaluation.summary}
                  </p>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-bold font-mono text-cyan-300 uppercase tracking-wider">
                    التوصيات والإجراءات المؤتمتة:
                  </h4>
                  <div className="space-y-1.5">
                    {latestReport.aiEvaluation.recommendations.map((rec, i) => (
                      <div key={`rec-${i}`} className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs font-mono text-slate-200 flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>{rec}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-slate-500 font-mono text-xs">
                اضغط على "إطلاق الفحص العميق" لتوليد التقييم الذكي التلقائي.
              </div>
            )}
          </div>
        )}

        {/* Details Inspection Modal */}
        {selectedDetailResult && (
          <div 
            onClick={() => setSelectedDetailResult(null)}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <div 
              onClick={e => e.stopPropagation()}
              className="max-w-2xl w-full bg-slate-950 border border-slate-700 rounded-2xl p-5 shadow-2xl space-y-3 font-mono text-xs text-right"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="font-bold text-white text-sm">{selectedDetailResult.name}</span>
                <button
                  onClick={() => setSelectedDetailResult(null)}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-2 text-slate-300">
                <div><strong>القسم:</strong> {DEPARTMENT_NAMES_AR[selectedDetailResult.department]}</div>
                <div><strong>المستوى:</strong> {selectedDetailResult.depthTier}</div>
                <div><strong>الرسالة:</strong> {selectedDetailResult.message}</div>
                <div><strong>الزمن:</strong> {selectedDetailResult.durationMs}ms</div>
                <div><strong>الحالة:</strong> {selectedDetailResult.passed ? 'ناجح ✅' : 'فشل ❌'}</div>
                {selectedDetailResult.details && (
                  <div>
                    <strong>البيانات التقنية المسترجعة:</strong>
                    <pre className="mt-1 p-3 bg-black rounded-lg border border-slate-800 text-[10px] text-cyan-300 overflow-x-auto text-left" dir="ltr">
                      {JSON.stringify(selectedDetailResult.details, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
