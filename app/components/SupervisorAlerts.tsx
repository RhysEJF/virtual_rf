'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { useToast } from '@/app/hooks/useToast';
import type { SupervisorAlert, SupervisorAlertSeverity, SupervisorAlertStatus } from '@/lib/db/schema';

interface SupervisorAlertsProps {
  onWorkerClick?: (workerId: string) => void;
  onOutcomeClick?: (outcomeId: string) => void;
}

const severityConfig: Record<SupervisorAlertSeverity, { label: string; variant: 'error' | 'warning' | 'info' | 'default' }> = {
  critical: { label: 'Critical', variant: 'error' },
  high: { label: 'High', variant: 'error' },
  medium: { label: 'Medium', variant: 'warning' },
  low: { label: 'Low', variant: 'info' },
};

const typeLabels: Record<string, string> = {
  stuck: 'Stuck',
  no_progress: 'No Progress',
  repeated_errors: 'Repeated Errors',
  high_cost: 'High Cost',
  suspicious_behavior: 'Suspicious Behavior',
  worker_paused: 'Worker Paused',
  scope_violation: 'Scope Violation',
  env_access: 'Env File Access',
  mass_deletion: 'Mass Deletion',
  system_file_access: 'System File Access',
};

export function SupervisorAlerts({ onWorkerClick, onOutcomeClick }: SupervisorAlertsProps): JSX.Element | null {
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<SupervisorAlert[]>([]);
  const [supervisorRunning, setSupervisorRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const fetchAlerts = useCallback(async () => {
    try {
      // Fetch supervisor status and active alerts in parallel
      const [statusRes, alertsRes] = await Promise.all([
        fetch('/api/supervisor'),
        fetch('/api/supervisor/alerts?status=active'),
      ]);

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setSupervisorRunning(statusData.running);
      }

      if (alertsRes.ok) {
        const alertsData = await alertsRes.json();
        setAlerts(alertsData.alerts || []);
      }
    } catch (err) {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const handleToggleSupervisor = async () => {
    try {
      const response = await fetch('/api/supervisor', {
        method: supervisorRunning ? 'DELETE' : 'POST',
      });
      const data = await response.json();
      if (data.success) {
        toast({
          type: 'success',
          message: supervisorRunning ? 'Supervisor stopped' : 'Supervisor started',
        });
        setSupervisorRunning(!supervisorRunning);
      } else {
        toast({ type: 'error', message: data.message || 'Failed to toggle supervisor' });
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to toggle supervisor' });
    }
  };

  const handleAcknowledge = async (alertId: number) => {
    setActionLoading(alertId);
    try {
      const response = await fetch('/api/supervisor/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert_id: alertId, action: 'acknowledge' }),
      });
      const data = await response.json();
      if (data.success) {
        toast({ type: 'success', message: 'Alert acknowledged' });
        fetchAlerts();
      } else {
        toast({ type: 'error', message: data.error || 'Failed to acknowledge alert' });
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to acknowledge alert' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleResolve = async (alertId: number) => {
    setActionLoading(alertId);
    try {
      const response = await fetch('/api/supervisor/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert_id: alertId, action: 'resolve' }),
      });
      const data = await response.json();
      if (data.success) {
        toast({ type: 'success', message: 'Alert resolved' });
        fetchAlerts();
      } else {
        toast({ type: 'error', message: data.error || 'Failed to resolve alert' });
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to resolve alert' });
    } finally {
      setActionLoading(null);
    }
  };

  const formatTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  if (loading) {
    return null;
  }

  return (
    <Card padding="md">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Supervisor</CardTitle>
          {supervisorRunning ? (
            <Badge variant="success">Running</Badge>
          ) : (
            <Badge variant="default">Stopped</Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleToggleSupervisor}
        >
          {supervisorRunning ? 'Stop' : 'Start'}
        </Button>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-text-tertiary text-sm">
              {supervisorRunning
                ? 'No active alerts - all workers healthy'
                : 'Supervisor is not running'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => {
              const severity = severityConfig[alert.severity];
              const isLoading = actionLoading === alert.id;
              return (
                <div
                  key={alert.id}
                  className={`p-3 rounded-lg border ${
                    alert.severity === 'critical' || alert.severity === 'high'
                      ? 'bg-status-error/10 border-status-error/30'
                      : alert.severity === 'medium'
                        ? 'bg-status-warning/10 border-status-warning/30'
                        : 'bg-bg-tertiary border-border'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={severity.variant}>{severity.label}</Badge>
                      <span className="text-xs text-text-tertiary">
                        {typeLabels[alert.type] || alert.type}
                      </span>
                      {alert.auto_paused && (
                        <Badge variant="info" className="text-[10px]">Auto-paused</Badge>
                      )}
                    </div>
                    <span className="text-xs text-text-tertiary">
                      {formatTime(alert.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-text-primary mb-2">{alert.message}</p>
                  <div className="flex items-center gap-2">
                    {alert.status === 'active' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleAcknowledge(alert.id)}
                        disabled={isLoading}
                      >
                        Acknowledge
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleResolve(alert.id)}
                      disabled={isLoading}
                    >
                      Resolve
                    </Button>
                    {onWorkerClick && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onWorkerClick(alert.worker_id)}
                      >
                        View Worker
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
