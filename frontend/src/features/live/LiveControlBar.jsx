import { IconLock, IconRotate, IconSettings } from '@tabler/icons-react';

export default function LiveControlBar({
  orientationLocked,
  onToggleOrientation,
  recording,
  onToggleRecording,
  onOpenConfig,
}) {
  return (
    <div className="live-bar">
      <button
        type="button"
        className="live-bar-btn"
        onClick={onToggleOrientation}
        aria-label={orientationLocked ? 'Desbloquear orientación' : 'Bloquear orientación'}
        title={orientationLocked ? 'Orientación bloqueada' : 'Orientación libre'}
      >
        {orientationLocked ? <IconLock size={26} stroke={2.2} /> : <IconRotate size={26} stroke={2.2} />}
      </button>

      <button
        type="button"
        className={`live-record ${recording ? 'is-recording' : ''}`}
        onClick={onToggleRecording || undefined}
        disabled={!onToggleRecording}
        aria-pressed={!!recording}
      >
        <span className="live-record-dot" />
        <span>{recording ? 'GRABANDO' : 'GRABAR'}</span>
      </button>

      <button
        type="button"
        className="live-bar-btn"
        onClick={onOpenConfig || undefined}
        disabled={!onOpenConfig}
        aria-label="Configuración"
        title="Configuración"
      >
        <IconSettings size={26} stroke={2.2} />
      </button>
    </div>
  );
}
