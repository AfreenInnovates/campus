"use client";

import { CuboidCollider, RigidBody } from "@react-three/rapier";
import type { ReactNode } from "react";
import type { Vec3 } from "../level";
import { useSimulation } from "../store";
import { HAND_FONT, wood, floorTiles, plaster, paving } from "../textures";
import {
  BottleShelf,
  BulletinBoard,
  ExitSign,
  FireAlarm,
  HangingSign,
  LabIsland,
  PaintedSign,
  PendantLight,
  Poster,
  PottedPlant,
  Projector,
  ProjectorScreen,
  RecycleBin,
  Speaker,
  Stool,
  StudentDesk,
  SunsetWindow,
  WritingBoard,
  Banner,
  Bench,
  Beakers,
  Glow,
} from "./Decor";
import {
  Cabinet,
  CeilingLight,
  CeilingPipes,
  ClassroomPodium,
  ClimbableStack,
  Desk,
  EvacuationStair,
  FloorMark,
  FumeHood,
  GlassCabinet,
  Locker,
  MicroscopeStation,
  Plant,
  Reception,
  Shelf,
  Sofa,
  WallClock,
  WallTrim,
  WoodCrate,
  Chair, Monitor} from "./Furniture";

const INK = "#231c2b";
const CORAL = "#ff6a3d";
const VIOLET = "#7b5cff";
const MINT = "#2fd18f";
const SUN = "#ffc44d";

/**
 * Wall-mounted decor. The warden's walls are cut down to knee height, so anything hung on
 * them would float; south walls and ceilings are only drawn in the evacuee's own view.
 */
function OnWalls({ children }: { children: ReactNode }) {
  const warden = useSimulation((s) => s.mode.kind === "warden");
  return <group visible={!warden}>{children}</group>;
}

function EvacueeOnly({ children }: { children: ReactNode }) {
  const evacueeView = useSimulation((s) => s.view === "evacuee");
  return <group visible={evacueeView}>{children}</group>;
}

/** A doorway between blocks, with the destination painted above it. Local +Z faces the viewer. */
function Doorway({
  id,
  position,
  rotationY,
  title,
  sub,
  color,
  icon = null,
}: {
  id: string;
  position: Vec3;
  rotationY: number;
  title: string;
  sub: string;
  color: string;
  icon?: "flask" | "molecule" | null;
}) {
  const trim = wood("#7a5236", 1, 3);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {[-0.92, 0.92].map((x) => (
        <mesh key={x} position={[x, 1.25, 0.17]} castShadow>
          <boxGeometry args={[0.12, 2.5, 0.06]} />
          <meshStandardMaterial map={trim} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 2.46, 0.255]}>
        <boxGeometry args={[1.96, 0.12, 0.06]} />
        <meshStandardMaterial map={trim} roughness={0.6} />
      </mesh>
      <OnWalls>
        <PaintedSign
          id={id}
          position={[0, 3.05, 0.255]}
          width={2.3}
          height={0.62}
          background={INK}
          border={color}
          icon={icon}
          iconColor={color}
          padding={0.14}
          lines={[
            { text: title, size: 0.34, color: "#fff6ea", weight: 900, tracking: 0.02 },
            { text: sub, size: 0.2, color, weight: 700, gap: 0.04 },
          ]}
        />
      </OnWalls>
    </group>
  );
}

/* ------------------------------------------------------------------ entrance */

function Entrance() {
  return (
    <group>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 1.05, 0, 10.5]} rotation={[0, side * 0.5, 0]}>
          <mesh position={[0, 1.3, 0]}>
            <boxGeometry args={[1.35, 2.5, 0.05]} />
            <meshPhysicalMaterial color="#cfe6f2" transparent opacity={0.3} roughness={0.05} metalness={0.1} transmission={0.9} thickness={0.05} />
          </mesh>
          {[-0.66, 0.66].map((x) => (
            <mesh key={x} position={[x, 1.3, 0]} castShadow>
              <boxGeometry args={[0.05, 2.5, 0.07]} />
              <meshStandardMaterial color="#2d2a33" metalness={0.7} roughness={0.3} />
            </mesh>
          ))}
          <mesh position={[0, 1.2, 0.075]}>
            <boxGeometry args={[0.9, 0.04, 0.04]} />
            <meshStandardMaterial color="#a9a1ac" metalness={0.85} roughness={0.15} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.012, 14.1]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[2.8, 1.6]} />
        <meshStandardMaterial map={floorTiles("#4a3b52", 2.8, 1.6, 0.4)} roughness={0.25} metalness={0.15} />
      </mesh>

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider position={[3.675, 0.4, 12.975]} args={[0.3, 0.4, 0.9]} />
        <Bench position={[3.675, 0, 12.975]} rotationY={-Math.PI / 2} />
      </RigidBody>
      <EvacuationStair position={[-1.65, 0, 11.025]} />
      <FloorMark position={[-1.65, 0, 13.95]} size={[0.34, 1.8]} color="#39ff88" opacity={0.85} />
      <PottedPlant position={[-3.825, 0, 15.075]} scale={0.9} />

      <OnWalls>
        <ExitSign position={[0, 2.9, 15.45]} rotationY={Math.PI} />
        <PaintedSign
          id="entry-welcome"
          position={[-4.245, 1.75, 13.05]}
          rotationY={Math.PI / 2}
          width={1.5}
          height={1.1}
          background="#fff6ea"
          border={INK}
          align="left"
          valign="top"
          padding={0.1}
          lines={[
            { text: "WELCOME", size: 0.15, color: CORAL, weight: 900, tracking: 0.01 },
            { text: "Science Block, Level 1", size: 0.1, color: INK, weight: 700, gap: 0.03 },
            { text: "In a drill: walk, don't run.", size: 0.085, color: "#5c5066", weight: 600, gap: 0.08 },
            { text: "Know two ways out.", size: 0.085, color: "#5c5066", weight: 600, gap: 0.02 },
          ]}
        />
      </OnWalls>
      <EvacueeOnly>
        <HangingSign
          id="west-stair"
          position={[-1.65, 3.05, 12.15]}
          width={2.1}
          height={0.44}
          drop={0.3}
          background="#128a4a"
          icon="running"
          iconColor="#f2fff6"
          padding={0.12}
          lines={[
            { text: "EMERGENCY STAIR", size: 0.42, color: "#f2fff6", weight: 900, tracking: 0.02 },
          ]}
        />
        <CeilingLight position={[0, 3.72, 13.2]} />
      </EvacueeOnly>
      <pointLight position={[0, 3, 13.2]} intensity={5} distance={9} decay={2} color="#fff1dc" />
    </group>
  );
}

/* ------------------------------------------------------------------ corridor */

function Foyer() {
  return (
    <group>
      <RigidBody type="fixed" colliders="cuboid">
        <Reception position={[-3.9, 0, 7.5]} />
        <Sofa position={[5.85, 0, 6.3]} rotationY={-Math.PI / 2} />
        <mesh position={[0, 0.22, -1.8]} castShadow receiveShadow>
          <boxGeometry args={[1.6, 0.44, 1.6]} />
          <meshStandardMaterial map={wood("#8a5f3f", 1.6, 0.5)} roughness={0.7} />
        </mesh>
      </RigidBody>
      <Plant position={[0, 0.44, -1.8]} scale={1.25} />
      <PottedPlant position={[-7.2, 0, 9.3]} />
      <PottedPlant position={[7.2, 0, 9.3]} />
      <PottedPlant position={[-7.2, 0, -9.3]} />
      <PottedPlant position={[7.2, 0, -9.3]} />
      <RecycleBin position={[7.35, 0, -0.6]} />
      <Beakers position={[-4.35, 1.08, 7.35]} seed={1} />

      {/* green return route on the floor */}
      <FloorMark position={[0, 0, 5.4]} size={[0.3, 5.5]} color={MINT} opacity={0.5} />

      <Doorway
        id="door-science"
        position={[-8.43, 0, 3.75]}
        rotationY={Math.PI / 2}
        title="SCIENCE BLOCK"
        sub="Chemistry Lab 1A"
        color={MINT}
        icon="flask"
      />
      <Doorway
        id="door-academic"
        position={[8.43, 0, 3.75]}
        rotationY={-Math.PI / 2}
        title="ACADEMIC BLOCK"
        sub="Classroom A201"
        color={SUN}
      />

      <OnWalls>
        <WallTrim position={[0, 0, -10.08]} width={9.8} accent={CORAL} />
        <SunsetWindow id="foyer-west" position={[-4.875, 0, -10.26]} width={2.5} height={2.1} />
        <SunsetWindow id="foyer-east" position={[4.875, 0, -10.26]} width={2.5} height={2.1} />
        <PaintedSign
          id="foyer-feature"
          position={[0, 2.05, -10.245]}
          width={2.9}
          height={1.6}
          background={INK}
          align="left"
          valign="top"
          padding={0.09}
          lines={[
            { text: "SCIENCE BLOCK / L1", size: 0.08, color: SUN, weight: 800, tracking: 0.01 },
            { text: "Central", size: 0.2, color: "#fff6ea", weight: 900, gap: 0.04 },
            { text: "Corridor", size: 0.2, color: "#fff6ea", weight: 900 },
            { text: "West door: Chemistry Lab 1A", size: 0.075, color: MINT, weight: 700, gap: 0.08 },
            { text: "East door: Classroom A201", size: 0.075, color: SUN, weight: 700, gap: 0.02 },
            { text: "Exit: back through the south doors", size: 0.075, color: CORAL, weight: 700, gap: 0.02 },
          ]}
        />
        <BulletinBoard id="foyer-board" position={[7.995, 1.65, -4.8]} rotationY={-Math.PI / 2} />
        <FireAlarm position={[-7.995, 1.35, -0.6]} rotationY={Math.PI / 2} />
        <Poster
          id="foyer-poster"
          position={[-7.995, 1.8, -5.4]}
          rotationY={Math.PI / 2}
          width={1.2}
          height={1.6}
          background={VIOLET}
          align="left"
          valign="top"
          padding={0.1}
          lines={[
            { text: "IN A", size: 0.1, color: "#fff6ea", weight: 900 },
            { text: "DRILL", size: 0.16, color: SUN, weight: 900 },
            { text: "1. Stop and listen", size: 0.06, color: "#fff6ea", weight: 700, gap: 0.06 },
            { text: "2. Read the signs", size: 0.06, color: "#fff6ea", weight: 700, gap: 0.02 },
            { text: "3. Grab your kit", size: 0.06, color: "#fff6ea", weight: 700, gap: 0.02 },
            { text: "4. Walk to the exit", size: 0.06, color: "#fff6ea", weight: 700, gap: 0.02 },
          ]}
        />
      </OnWalls>
      <EvacueeOnly>
        <ExitSign position={[0, 3.25, 10.275]} rotationY={Math.PI} scale={0.9} />
        <CeilingLight position={[0, 3.72, 6.3]} />
        <CeilingLight position={[0, 3.72, -0.9]} />
        <CeilingLight position={[0, 3.72, -7.8]} />
      </EvacueeOnly>
      <pointLight position={[0, 3.1, 0.75]} intensity={8} distance={14} decay={2} color="#fff1dc" />
    </group>
  );
}

/* ------------------------------------------------------------- chemistry lab */

function GasManifold() {
  const pipe = "#c8b25a";
  return (
    <group>
      <mesh position={[-29.175, 1.9, -10.08]}>
        <cylinderGeometry args={[0.05, 0.05, 3.8, 10]} />
        <meshStandardMaterial color={pipe} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[-29.175, 0.95, -8.25]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 2.45, 10]} />
        <meshStandardMaterial color={pipe} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[-29.175, 1.02, -6.525]}>
        <cylinderGeometry args={[0.06, 0.06, 0.18, 10]} />
        <meshStandardMaterial color="#8a8190" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[-29.175, 0.47, -6.525]}>
        <cylinderGeometry args={[0.05, 0.05, 0.95, 10]} />
        <meshStandardMaterial color={pipe} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[-29.175, 0.03, -6.525]}>
        <cylinderGeometry args={[0.16, 0.16, 0.06, 14]} />
        <meshStandardMaterial color="#5a5260" metalness={0.5} roughness={0.4} />
      </mesh>
    </group>
  );
}

function ChemistryLab() {
  return (
    <group>
      <RigidBody type="fixed" colliders="cuboid">
        <Desk position={[-22.5, 0, -8.85]} size={[5.2, 0.75, 1.1]} />
        <Desk position={[-14.4, 0, 3.9]} size={[1.8, 0.72, 0.9]} rotationY={0.2} />
        <Locker position={[-32.25, 0, -7.8]} />
        <Locker position={[-32.25, 0, -5.85]} />
        <Shelf position={[-32.25, 0, 0.6]} />
        <Cabinet position={[-12.9, 0, -6.6]} rotationY={Math.PI} />
        <Cabinet position={[-12.9, 0, -5.25]} rotationY={Math.PI} />
        <GlassCabinet position={[-31.2, 0, -2.55]} />
        <GlassCabinet position={[-13.875, 0, -2.55]} rotationY={Math.PI} />
      </RigidBody>

      {/* the two lab islands carry explicit colliders so their glassware stays decorative */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider position={[-22.5, 0.48, -2.7]} args={[2.89, 0.48, 0.64]} />
        <CuboidCollider position={[-22.5, 0.48, 3.6]} args={[2.14, 0.48, 0.64]} />
        <CuboidCollider position={[-30.75, 0.45, 7.125]} args={[0.45, 0.45, 0.3]} />
      </RigidBody>
      <LabIsland position={[-22.5, 0, -2.7]} width={5.7} />
      <LabIsland position={[-22.5, 0, 3.6]} width={4.2} />
      <mesh position={[-20.55, 1.02, -2.7]} castShadow>
        <boxGeometry args={[0.52, 0.12, 0.38]} />
        <meshStandardMaterial color="#e6dfe8" roughness={0.6} />
      </mesh>
      <MicroscopeStation position={[-24.375, 0.07, -2.7]} />
      <MicroscopeStation position={[-22.8, 0.07, 3.6]} rotationY={0.15} />
      {[-17.2, -15.6, -14, -12.8].map((x, index) => (
        <Stool key={x} position={[x, 0, index % 2 ? -0.75 : -2.9]} />
      ))}
      {[-16.4, -14.9, -13.4].map((x) => (
        <Stool key={x} position={[x, 0, 3.45]} />
      ))}

      {/* back bench and fume hood */}
      <Beakers position={[-24.6, 0.76, -8.85]} seed={2} />
      <Beakers position={[-20.1, 0.76, -8.7]} seed={3} />
      <FumeHood position={[-16.875, 0, -8.775]} accent={CORAL} />

      {/* first-aid station */}
      <group position={[-30.75, 0, 7.125]}>
        <mesh position={[0, 0.87, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.9, 0.06, 0.6]} />
          <meshStandardMaterial color="#efe9f0" roughness={0.5} />
        </mesh>
        {[-0.4, 0.4].map((x) => (
          <mesh key={x} position={[x, 0.42, 0]}>
            <boxGeometry args={[0.05, 0.84, 0.5]} />
            <meshStandardMaterial color="#8a8190" metalness={0.5} roughness={0.4} />
          </mesh>
        ))}
      </group>

      <GasManifold />
      <ClimbableStack position={[-18.6, 0, 8.025]} color="#8a6a4a" height={2} />
      <PottedPlant position={[-13.35, 0, 8.85]} />
      <RecycleBin position={[-13.5, 0, -0.3]} color="#2f9c6a" />

      <OnWalls>
        <WallTrim position={[-22.5, 0, -10.08]} width={12.8} accent={MINT} />
        <SunsetWindow id="lab-west" position={[-32.76, 0, 4.35]} rotationY={Math.PI / 2} width={2.8} />
        <SunsetWindow id="lab-north" position={[-25.8, 0, -10.26]} width={2.2} height={1.2} sill={2.2} shaft={false} />
        <WritingBoard
          id="lab-board"
          position={[-21.3, 2.35, -10.245]}
          width={2.6}
          height={1.1}
          kind="marker"
          lines={[
            { text: "Science Builds", size: 0.16, color: "#3b4f7a" },
            { text: "Brighter Tomorrows", size: 0.16, color: "#c2412d" },
            { text: "Gas off before you leave!", size: 0.1, color: "#3b4f7a", gap: 0.08 },
          ]}
        />
        <BottleShelf position={[-16.875, 2.9, -10.05]} width={2.4} />
        <PaintedSign
          id="gas-shutoff"
          position={[-29.175, 2.05, -10.245]}
          width={1.2}
          height={0.72}
          background="#d8312f"
          icon="hazard"
          iconColor={SUN}
          padding={0.12}
          lines={[
            { text: "GAS", size: 0.3, color: "#fff6ea", weight: 900 },
            { text: "SHUT-OFF", size: 0.2, color: "#fff6ea", weight: 900 },
          ]}
        />
        <PaintedSign
          id="first-aid-sign"
          position={[-32.76, 1.85, 7.125]}
          rotationY={Math.PI / 2}
          width={0.9}
          height={0.62}
          background="#11a352"
          icon="cross"
          iconColor="#ffffff"
          padding={0.12}
          lines={[
            { text: "FIRST", size: 0.26, color: "#ffffff", weight: 900 },
            { text: "AID", size: 0.26, color: "#ffffff", weight: 900 },
          ]}
        />
        <Poster
          id="lab-rules"
          position={[-12.255, 1.85, 0.525]}
          rotationY={-Math.PI / 2}
          width={1.05}
          height={1.4}
          background="#fff6ea"
          align="left"
          valign="top"
          padding={0.08}
          lines={[
            { text: "LAB SAFETY", size: 0.1, color: CORAL, weight: 900 },
            { text: "Goggles on", size: 0.068, color: INK, weight: 700, gap: 0.06 },
            { text: "Know the gas valve", size: 0.068, color: INK, weight: 700, gap: 0.03 },
            { text: "First aid by window", size: 0.068, color: INK, weight: 700, gap: 0.03 },
            { text: "Exit: back door, then", size: 0.068, color: INK, weight: 700, gap: 0.03 },
            { text: "south to the foyer", size: 0.068, color: INK, weight: 700 },
          ]}
        />
        <PaintedSign
          id="lab-access"
          position={[-12.255, 1.75, 6.45]}
          rotationY={-Math.PI / 2}
          width={0.95}
          height={0.5}
          background={SUN}
          padding={0.1}
          lines={[
            { text: "LAB ACCESS", size: 0.3, color: INK, weight: 900 },
            { text: "sign in / card", size: 0.2, color: INK, weight: 600 },
          ]}
        />
        <ExitSign position={[-12.255, 2.72, 3.75]} rotationY={-Math.PI / 2} scale={0.8} />
        <FireAlarm position={[-12.255, 1.35, 8.4]} rotationY={-Math.PI / 2} />
        <WallClock position={[-32.67, 2.6, -2.55]} rotationY={Math.PI / 2} />
        <Speaker position={[-32.55, 3.2, -8.85]} rotationY={Math.PI / 2} />
      </OnWalls>
      <EvacueeOnly>
        <Banner
          id="lab-banner"
          position={[-22.5, 2.4, 10.2]}
          rotationY={Math.PI}
          width={3.6}
          height={0.8}
          background="#2f5fd0"
          lines={[
            { text: "CURIOSITY FUELS", size: 0.3, color: "#ffffff", weight: 900, tracking: 0.01 },
            { text: "A SAFER TOMORROW", size: 0.3, color: SUN, weight: 900, tracking: 0.01 },
          ]}
        />
        <HangingSign
          id="lab-name"
          position={[-15.9, 3.1, 0.45]}
          rotationY={Math.PI / 2}
          width={2}
          height={0.44}
          drop={0.25}
          background="#fff6ea"
          border={INK}
          icon="flask"
          iconColor={MINT}
          padding={0.12}
          lines={[{ text: "CHEMISTRY LAB 1A", size: 0.4, color: INK, weight: 900 }]}
        />
        <CeilingPipes position={[-22.5, 3.5, -6.6]} length={11.5} color="#8d8196" />
        {[-17.2, -12.8].flatMap((x) =>
          [-1.8, 2.4].map((z) => <PendantLight key={`${x}${z}`} position={[x, 3.2, z]} length={2.2} />),
        )}
      </EvacueeOnly>
      <pointLight position={[-22.5, 2.9, -2.7]} intensity={9} distance={13} decay={2} color="#fff1dc" />
      <pointLight position={[-22.5, 2.9, 5.4]} intensity={6} distance={11} decay={2} color="#ffe6c9" />
      <Glow position={[-16.875, 1.45, -7.8]} color="#d8f6ff" size={1.8} opacity={0.2} />
    </group>
  );
}

/* ------------------------------------------------------------------ classroom */

const DESK_COLUMNS = [10.4, 12.2, 17.8, 19.6];
const DESK_ROWS = [1.25, -0.95, -3.15];

function Classroom() {
  return (
    <group>
      <RigidBody type="fixed" colliders="cuboid">
        <WoodCrate position={[31.05, 0.5, 6.45]} />
        <WoodCrate position={[31.05, 1.5, 6.45]} />
        <WoodCrate position={[29.25, 0.5, 7.35]} />
        <Desk position={[15.9, 0, 6.45]} size={[1.7, 0.75, 0.9]} />
        <Locker position={[32.1, 0, -6.6]} />
        <Locker position={[32.1, 0, -4.65]} />
        <Cabinet position={[12.9, 0, -6.6]} />
      </RigidBody>

      <RigidBody type="fixed" colliders={false}>
        {DESK_COLUMNS.flatMap((x) =>
          DESK_ROWS.map((z) => <CuboidCollider key={`${x}${z}`} position={[x, 0.39, z]} args={[0.6, 0.39, 0.3]} />),
        )}
      </RigidBody>
      {DESK_COLUMNS.flatMap((x, column) =>
        DESK_ROWS.map((z, row) => (
          <StudentDesk key={`${x}${z}`} position={[x, 0, z]} item={x === 12.2 && z === 1.25 ? 2 : column * 3 + row} />
        )),
      )}

      <ClassroomPodium position={[22.5, 0, 7.575]} rotationY={Math.PI} />
      <ClimbableStack position={[29.4, 0, 7.2]} color="#8a6a4a" height={2} />
      <PottedPlant position={[13.5, 0, 9.3]} />
      <PottedPlant position={[31.95, 0, 9.45]} scale={0.85} />
      <RecycleBin position={[13.05, 0, -8.7]} />

      <OnWalls>
        <WallTrim position={[22.5, 0, -10.08]} width={12.8} accent={SUN} />
        <SunsetWindow id="class-north-west" position={[16.2, 0, -10.26]} width={2.6} />
        <SunsetWindow id="class-north-east" position={[28.8, 0, -10.26]} width={2.6} />
        <SunsetWindow id="class-east" position={[32.76, 0, 0.3]} rotationY={-Math.PI / 2} width={3.2} />
        <PaintedSign
          id="service-door"
          position={[22.5, 3.32, -10.245]}
          width={1.9}
          height={0.4}
          background={INK}
          icon="hazard"
          iconColor={SUN}
          padding={0.12}
          lines={[{ text: "ELECTRICAL SERVICE", size: 0.4, color: "#fff6ea", weight: 900 }]}
        />
        <BulletinBoard id="class-board" position={[12.255, 1.65, -3.3]} rotationY={Math.PI / 2} />
        <ExitSign position={[12.255, 2.72, 3.75]} rotationY={Math.PI / 2} scale={0.8} />
        <WallClock position={[32.67, 2.45, -7.275]} rotationY={-Math.PI / 2} />
        <FireAlarm position={[12.255, 1.35, 8.4]} rotationY={Math.PI / 2} />
        <Speaker position={[32.55, 3.2, 8.1]} rotationY={-Math.PI / 2} />
      </OnWalls>
      <EvacueeOnly>
        <ProjectorScreen
          id="class-slide"
          position={[22.5, 2.2, 10.2]}
          rotationY={Math.PI}
          width={3.3}
          height={1.85}
          lines={[
            { text: "EVACUATION ROUTE", size: 0.1, color: "#5b4a9c", weight: 900 },
            { text: "Stay calm. Walk.", size: 0.13, color: INK, weight: 800, gap: 0.06 },
            { text: "1  Leave A201 by the west door", size: 0.068, color: "#3d3350", weight: 600, gap: 0.08 },
            { text: "2  Cross the central corridor", size: 0.068, color: "#3d3350", weight: 600, gap: 0.03 },
            { text: "3  Out through the south doors", size: 0.068, color: "#3d3350", weight: 600, gap: 0.03 },
            { text: "4  Wait at the assembly point", size: 0.068, color: "#3d3350", weight: 600, gap: 0.03 },
          ]}
        />
        <WritingBoard
          id="class-chalk-left"
          position={[16.95, 1.9, 10.245]}
          rotationY={Math.PI}
          width={2.7}
          height={1.2}
          lines={[
            { text: "Today: Fire safety", size: 0.14 },
            { text: "- 2 exits from every room", size: 0.1, gap: 0.06 },
            { text: "- never use the lift", size: 0.1, gap: 0.02 },
            { text: "- meet at the plaza", size: 0.1, gap: 0.02 },
          ]}
        />
        <WritingBoard
          id="class-chalk-right"
          position={[28.05, 1.9, 10.245]}
          rotationY={Math.PI}
          width={2.7}
          height={1.2}
          lines={[
            { text: "People, ideas,", size: 0.14, font: HAND_FONT },
            { text: "safer campuses.", size: 0.14, font: HAND_FONT, color: "#ffd98a" },
            { text: "Homework: map your route", size: 0.1, gap: 0.08 },
          ]}
        />
        <HangingSign
          id="class-name"
          position={[14.85, 3.1, 0.45]}
          rotationY={Math.PI / 2}
          width={1.9}
          height={0.44}
          drop={0.25}
          background="#fff6ea"
          border={INK}
          padding={0.12}
          lines={[{ text: "CLASSROOM A201", size: 0.4, color: INK, weight: 900 }]}
        />
        <Projector position={[22.5, 3.25, 1.8]} />
        {[12, 18].flatMap((x) => [-3, 1.5].map((z) => <CeilingLight key={`${x}${z}`} position={[x, 3.72, z]} />))}
      </EvacueeOnly>
      <pointLight position={[19.5, 3, -1.5]} intensity={6} distance={12} decay={2} color="#fff1dc" />
      <pointLight position={[26.25, 3, -1.5]} intensity={6} distance={12} decay={2} color="#fff1dc" />
    </group>
  );
}


/* ------------------------------------------------------------------ library */

function Library() {
  return (
    <group>
      <mesh position={[0, 0.012, -18]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[16.5, 15]} />
        <meshStandardMaterial map={wood("#5c4d44", 4, 1.2)} roughness={0.6} />
      </mesh>
      
      <RigidBody type="fixed" colliders="cuboid">
        {[-3, 3].map(x => (
          <group key={x}>
            <Desk position={[x, 0, -14]} rotationY={0} />
            <Chair position={[x, 0, -13]} rotationY={Math.PI} />
            
            <Desk position={[x, 0, -22]} rotationY={0} />
            <Chair position={[x, 0, -21]} rotationY={Math.PI} />
          </group>
        ))}
        
        {[-5, 0, 5].map(x => (
          <Shelf key={x} position={[x, 0, -24]} rotationY={0} />
        ))}
      </RigidBody>

      <OnWalls>
        <WallTrim position={[0, 0, -25.42]} width={16} accent={VIOLET} />
        <WallTrim position={[-8.18, 0, -18]} rotationY={Math.PI/2} width={15} accent={VIOLET} />
        <WallTrim position={[8.18, 0, -18]} rotationY={-Math.PI/2} width={15} accent={VIOLET} />
      </OnWalls>

      <EvacueeOnly>
        {[[-4, -14], [4, -14], [-4, -22], [4, -22]].map(([x, z]) => (
          <CeilingLight key={x+z} position={[x, 3.7, z]} />
        ))}
      </EvacueeOnly>
      <pointLight position={[0, 3, -18]} intensity={7} distance={15} decay={2} color="#fff" />
    </group>
  );
}

/* ------------------------------------------------------------------ server room */

function ServerRoom() {
  return (
    <group>
      <mesh position={[-22.5, 0.012, -18]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[21, 15]} />
        <meshStandardMaterial color="#2d2d30" roughness={0.3} metalness={0.8} />
      </mesh>
      
      <RigidBody type="fixed" colliders="cuboid">
        {[-26, -22, -18].map(x => (
          <group key={x}>
            <Cabinet position={[x, 0, -13]} rotationY={Math.PI} />
            <Cabinet position={[x, 0, -23]} rotationY={0} />
          </group>
        ))}
        
        <Desk position={[-14, 0, -18]} rotationY={Math.PI / 2} />
        <Chair position={[-13, 0, -18]} rotationY={-Math.PI / 2} />
        <Monitor position={[-14.2, 0.75, -18]} rotationY={Math.PI / 2} />
      </RigidBody>

      <OnWalls>
        <WallTrim position={[-22.5, 0, -25.42]} width={20} accent={MINT} />
        <WallTrim position={[-32.92, 0, -18]} rotationY={Math.PI/2} width={15} accent={MINT} />
      </OnWalls>

      <EvacueeOnly>
        {[[-26, -18], [-18, -18]].map(([x, z]) => (
          <CeilingLight key={x+z} position={[x, 3.7, z]} />
        ))}
      </EvacueeOnly>
      <pointLight position={[-22.5, 3, -18]} intensity={5} distance={15} decay={2} color="#b8d4ff" />
    </group>
  );
}

export default function Rooms() {
  return (
    <>
      <Entrance />
      <Foyer />
      <ChemistryLab />
      <Classroom />
      <Library />
      <ServerRoom />
    </>
  );
}
