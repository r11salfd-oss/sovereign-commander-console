import { useState, useEffect } from 'react';
import { DynamicWorkspaceInfo, fetchDynamicWorkspaceInfo, getFullDynamicWorkspaceInfo } from '../workspace/WorkspaceConfig';

export function useWorkspace() {
  const [workspaceInfo, setWorkspaceInfo] = useState<DynamicWorkspaceInfo>(getFullDynamicWorkspaceInfo());
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    fetchDynamicWorkspaceInfo()
      .then((info) => {
        if (isMounted) {
          setWorkspaceInfo(info);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return { workspaceInfo, loading };
}
