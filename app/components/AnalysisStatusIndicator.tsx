'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/hooks/useToast';

interface JobStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progressMessage: string | null;
  result?: {
    success: boolean;
    clusters: unknown[];
    proposals: unknown[];
    message: string;
  } | null;
  error?: string | null;
}

interface ActiveJobsResponse {
  success: boolean;
  jobs: JobStatus[];
}

interface AnalysisStatusIndicatorProps {
  onJobComplete?: (jobId: string, result: JobStatus['result']) => void;
}

const POLL_INTERVAL = 3000; // 3 seconds

export function AnalysisStatusIndicator({ onJobComplete }: AnalysisStatusIndicatorProps): JSX.Element | null {
  const { toast } = useToast();
  const [activeJob, setActiveJob] = useState<JobStatus | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [completedJobIds, setCompletedJobIds] = useState<Set<string>>(new Set());

  // Fetch active analysis jobs
  const fetchActiveJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/improvements/jobs/active');
      if (!response.ok) return;

      const data = await response.json() as ActiveJobsResponse;

      if (data.success && data.jobs.length > 0) {
        // Find the first running or pending job
        const runningJob = data.jobs.find(j => j.status === 'running' || j.status === 'pending');
        if (runningJob) {
          setActiveJob(runningJob);
          setIsVisible(true);
        }
      }
    } catch (error) {
      console.error('Failed to fetch active jobs:', error);
    }
  }, []);

  // Poll for job status when we have an active job
  const pollJobStatus = useCallback(async () => {
    if (!activeJob) return;

    try {
      const response = await fetch(`/api/improvements/jobs/${activeJob.id}`);
      if (!response.ok) {
        setActiveJob(null);
        setIsVisible(false);
        return;
      }

      const data = await response.json();
      if (!data.success) return;

      const job = data.job as JobStatus;
      setActiveJob(job);

      // Job completed or failed
      if (job.status === 'completed' || job.status === 'failed') {
        // Only show toast if we haven't already notified for this job
        if (!completedJobIds.has(job.id)) {
          setCompletedJobIds(prev => new Set(Array.from(prev).concat([job.id])));

          if (job.status === 'completed') {
            const clusterCount = job.result?.clusters?.length || 0;
            const proposalCount = job.result?.proposals?.length || 0;

            toast({
              type: 'success',
              message: `Analysis complete: ${clusterCount} pattern(s), ${proposalCount} proposal(s)`,
              duration: 8000,
              actions: onJobComplete ? [
                {
                  label: 'View Results',
                  onClick: () => onJobComplete(job.id, job.result),
                  variant: 'primary',
                },
              ] : undefined,
            });
          } else {
            toast({
              type: 'error',
              message: `Analysis failed: ${job.error || 'Unknown error'}`,
              duration: 6000,
            });
          }
        }

        // Hide the indicator after a short delay
        setTimeout(() => {
          setActiveJob(null);
          setIsVisible(false);
        }, 2000);
      }
    } catch (error) {
      console.error('Failed to poll job status:', error);
    }
  }, [activeJob, completedJobIds, toast, onJobComplete]);

  // Check for active jobs on mount
  useEffect(() => {
    fetchActiveJobs();
  }, [fetchActiveJobs]);

  // Poll for status updates when we have an active job
  useEffect(() => {
    if (!activeJob || activeJob.status === 'completed' || activeJob.status === 'failed') {
      return;
    }

    const interval = setInterval(pollJobStatus, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [activeJob, pollJobStatus]);

  // Don't render if no active job
  if (!isVisible || !activeJob) {
    return null;
  }

  const isRunning = activeJob.status === 'running' || activeJob.status === 'pending';
  const isCompleted = activeJob.status === 'completed';
  const isFailed = activeJob.status === 'failed';

  return (
    <div
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-full text-xs
        transition-all duration-300
        ${isRunning ? 'bg-accent/10 text-accent border border-accent/30' : ''}
        ${isCompleted ? 'bg-status-success/10 text-status-success border border-status-success/30' : ''}
        ${isFailed ? 'bg-status-error/10 text-status-error border border-status-error/30' : ''}
      `}
      title={activeJob.progressMessage || 'Analysis in progress'}
    >
      {isRunning && (
        <>
          <svg
            className="animate-spin h-3 w-3"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="truncate max-w-[140px]">
            {activeJob.progressMessage || 'Analyzing...'}
          </span>
        </>
      )}
      {isCompleted && (
        <>
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
            <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Analysis complete</span>
        </>
      )}
      {isFailed && (
        <>
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
            <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>
          <span>Analysis failed</span>
        </>
      )}
    </div>
  );
}
