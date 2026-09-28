import { useState, useEffect } from 'react';
import { telemetryEngine, SystemTelemetrySnapshot } from '../services/systemTelemetryService';

export function useSystemTelemetry() {
  const [telemetry, setTelemetry] = useState<SystemTelemetrySnapshot>(telemetryEngine.getSnapshot());
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const unsubscribe = telemetryEngine.subscribe((snapshot) => {
      setTelemetry(snapshot);
    });
    return () => unsubscribe();
  }, []);

  const refreshNow = async () => {
    setIsRefreshing(true);
    try {
      const snap = await telemetryEngine.probeAllSubsystems();
      setTelemetry(snap);
    } finally {
      setIsRefreshing(false);
    }
  };

  return {
    telemetry,
    subsystems: telemetry.subsystems,
    overallLevel: telemetry.overallLevel,
    overallStatusText: telemetry.overallStatusText,
    isRefreshing,
    refreshNow
  };
}
