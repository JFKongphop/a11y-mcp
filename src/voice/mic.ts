// Voice input via the Web Speech API. Paxa's speech-to-text is still in progress
// and must not be depended on, so input uses the browser's built-in recognizer.

export interface MicHandle {
  stop: () => void;
}

export function listenThai(
  onResult: (text: string) => void,
  onError?: (err: string) => void
): MicHandle {
  const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!SR) throw new Error('Web Speech API unavailable');

  const rec = new SR();
  rec.lang = 'th-TH';
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onresult = (e: any) => {
    const transcript = e.results?.[0]?.[0]?.transcript ?? '';
    if (transcript) onResult(transcript);
  };
  rec.onerror = (e: any) => onError?.(e.error ?? 'speech-error');

  rec.start();
  return { stop: () => rec.stop() };
}
