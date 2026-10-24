"use client";
import { useMemo } from "react";
import { faceSvg, type FaceKit } from "@fl/sim";

export interface FacePlayer {
  id: number;
  name: string;
  age: number;
  nationality: string;
}

/** Porträt eines Spielers, erzeugt aus ID, Name, Herkunft und Alter. */
export function PlayerFace({ player, kit, size = 28, className }: { player: FacePlayer; kit?: FaceKit | null; size?: number; className?: string }) {
  const svg = useMemo(
    () => faceSvg(player, kit),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [player.id, player.name, player.age, player.nationality, kit?.primary, kit?.secondary],
  );
  return <span className={`face${className ? ` ${className}` : ""}`} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Name mit kleinem Porträt davor (für Tabellen). */
export function FaceName({ player, kit, children, size = 26 }: { player: FacePlayer; kit?: FaceKit | null; children?: React.ReactNode; size?: number }) {
  return (
    <span className="face-name">
      <PlayerFace player={player} kit={kit} size={size} />
      <span className="face-name-text">{children ?? player.name}</span>
    </span>
  );
}
