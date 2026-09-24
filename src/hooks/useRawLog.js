import { useSyncExternalStore } from 'react';
import { getRawLogSnapshot, isRawLogEnabled, subscribeRawLog } from '../lib/rawLog';

export const useRawLogEntries = () => useSyncExternalStore(subscribeRawLog, getRawLogSnapshot);
export const useRawLogEnabled = () => useSyncExternalStore(subscribeRawLog, isRawLogEnabled);
