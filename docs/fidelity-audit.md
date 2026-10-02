# 원작 대비 전수 검토 (Diablo II 1.14d 싱글)

2026-10-02 기준이다. 근거는 코드 위치(`파일:줄`)와 원작 표 열(MPQ 안 `data\global\excel\*.txt`)이다.

- 상태: ✅ 원작과 같음 · 🟡 부분/근사 · ❌ 없음 · ➖ 싱글엔 원래 없음
- "이번에"는 `feature/hit-feel`에서 고친 것이다.

## 1. 타격감·연출

| 항목 | 상태 | 근거 / 원작 동작 |
|---|---|---|
| 맞는 소리 (`impact_*`, HitClass별) | ✅ 이번에 | `data/sounds.ts` `impactSounds` — 무기 하위 4비트 + 원소 상위 4비트 겹소리 (근접만, 미사일은 HitSound) |
| 휘두름 소리 타이밍 | ✅ 이번에 | 첫 판정 프레임(`skillStart.hitTick`)에, 활·석궁은 시작에 `weapon_bow_draw` |
| 피 튀김 (MonStats2 `Bleed`) | ✅ 이번에 | Bleed 1 = blood1·2, 2 = bigblood 포함. 높이(`localBlood`)는 미반영 |
| 미사일 폭발 그림 (`ExplosionMissile`, `CltHitSubMissile1~4`, `AlwaysExplode`) | ✅ 이번에 | `game.ts clientExplode` — 서버 HitSubMissile과 이름이 같으면 겹쳐 그리지 않음. 흩뿌림 위치는 근사 |
| 상태 색 (States `colorpri`/`colorshift`) | ✅ 이번에 | Pal.PL2 색 바꾸기 표 111×256 (냉기 108·독 104·red 100) |
| 시전 섬광 (Skills `castoverlay`) | ✅ 이번에 | 시전자 자리에서 overlay.txt 프레임만큼. AnimRate는 근사 |
| 얼어 죽으면 부서짐 (States `shatter`) | ✅ 이번에 | 시체 없음, `icebreak*` 그림, `impact_shatter` |
| 밀쳐내기 방향 | ✅ 이번에 | 때린 유닛(용병·소환수·굴러온 바위) 반대쪽으로 |
| 몬스터 경직(GH)·밀쳐내기 | ✅ | `monster.ts:389 rollGetHit`, `game.ts knockBack` |
| 상태 걸릴 때 그림·소리 (States `castoverlay`, `onsound`/`offsound`) | ❌ | 저주·오라·냉기가 걸리거나 풀릴 때 한 번 나는 그림과 소리 |
| 스킬 대상 그림·소리 (`tgtoverlay`, `tgtsound`, `ItemCastSound`) | ❌ | 읽기만 함 (`skills/db.ts:114`) |
| 상태 오버레이 위치·순서 | 🟡 | `game.ts overlaySnapshots` — Xoffset/Height/PreDraw/AnimRate 미반영 |
| 미사일 애니 속도·반복 (`animrate`, `LoopAnim`, `SubLoop`) | 🟡 | `frame = age % animLen` |
| 미사일 반투명 방식 (`Trans`) | 🟡 | 모두 더하기 섞기 (`render/units.ts:354`) |
| 색 있는 빛·깜빡임 (Missiles `Red/Green/Blue`, `Flicker`) | 🟡 | 빛 반경은 있고 색·깜빡임 없음 (`render/lightmap.ts:11`) |
| 아이템 떨어질 때 도는 그림 (flippy) | 🟡 | 마지막 프레임만 (`render/units.ts:308`), 소리는 있음 |
| 몬스터 스킬 소리 (MonSounds `Skill1~4`) | ❌ | `monsterSkill` 사건을 소리가 안 받음 |
| 미사일 진행 소리 (`ProgSound`) | ❌ | |
| 발소리 무게·달리기 (light/medium/heavy × walk/run) | 🟡 | 늘 `light_walk_*` (`data/sounds.ts:149`) |
| 몬스터 발소리 (MonSounds `Footstep`) | ❌ | 읽기만 함 |
| 몬스터 등장·도발·도망 소리 (`Init`/`Taunt`/`Flee`) | ❌ | |
| 환경 오브젝트 소리 (횃불·파리·분수·강) | ❌ | `object_*_loop` 미사용 |
| UI 소리 (아이템 놓기·무기 바꾸기·큐브·수리·오류) | 🟡 | 일부만 (`sound.ts:149-678`) |
| 마을에서 공격하면 "여기선 안 돼" 대사 (`<직업>_not_in_town`) | ❌ | `skillUnusable` 사건에 소리 없음 |
| 신전 종류별 소리 | 🟡 | 늘 `object_shrine_holy` |
| 문·상자 재질별 소리 | 🟡 | 이름으로 추정 |
| 유니크 오라 (Aura Enchanted) | ❌ | 기록만 (`engine/uniques.ts:399`) — 오라 효과·그림 없음 |
| 유령 챔피언 반투명 | ❌ | |
| 시네마틱 (막 사이·엔딩 영상) | ❌ | 엔딩은 글로 대신 (`main.ts:1145`) |
| 퀘스트 버튼 깜빡임 | 🟡 | 메시지로 대신 |
| 날씨 | 🟡 | 비·눈 있음, 시점·모양 근사 |
| 몬스터 이름·생명 막대 | 🟡 | 원작 그림 대신 단순 사각형 (`ui/monbar.ts`) |
| 몬스터 죽음·시체, 변종·유니크 색, 조명·밤낮, 음악·배경음, 물약·금화·아이템 소리, NPC 대사, 레벨업·웨이포인트 소리, 로딩 화면 | ✅ | |
| 화면 흔들림·데미지 숫자 | ➖ | 원작에도 없음 |

## 2. 게임 시스템

| 항목 | 상태 | 근거 / 원작 동작 |
|---|---|---|
| 맨손 공격 | ❌ 버그 | 무기가 없으면 Attack(`itypea1 = weap`)이 막힘 (`game.ts weaponAllows`). 원작은 주먹으로 친다 |
| 비밀 소 레벨 (Wirt 다리 + TP 책 큐브) | ❌ | 실패로 처리 (`game.ts:10182`), Moo Moo Farm 없음 |
| `/players X` | ❌ | 몬스터 생명·경험치·드롭이 1인 기준 (`treasure.ts:195`) |
| 채팅 입력·명령 (`/players`, `/nopickup`) | ❌ | |
| 하드코어 | ❌ | 칭호 함수만 있음 (`difficulty.ts:123`) |
| 래더 전용 룬워드 | ❌ 버그 | runes.txt `server=1`(Spirit·Infinity·Insight 등)도 싱글에서 완성됨 (`runewords.ts:27`) |
| Valkyrie 장비 | 🟡 | 장비 굴림 생략 (`game.ts:3694`) |
| 큐브 조합 `op` 1~14 행 | 🟡 | 건너뜀 (`cube.ts:397`) |
| 화살·볼트 사서 자동 장착 | 🟡 | 생략 (`npc.ts:335`) |
| 시체 여러 개 | 🟡 | 하나로 합침 (`game.ts:820`) — 원작은 15개까지 |
| 보관함 금화 한도 | 🟡 | 레벨 공식 근사 (`game.ts:1571`) |
| 그 밖의 오브젝트 (무기 거치대 등) | 🟡 | 일반 상자 드롭으로 (`game.ts:11402`) |
| Act 5 용병 초상 | 🟡 | 로그 초상으로 대신 (`hireling.ts:128`) |
| 세트 보너스 | 🟡 | 개수 기준, `addFunc` 단순화 (`charstats.ts:65`) |
| 단축키 | 🟡 | 도움말(H)·채팅(Enter)·화면 지우기(Space)·휠 스킬 넘기기·스킬 단축키 16개 없음 (8개) |
| 옵션 | 🟡 | 감마·대비 없음, 조명 품질·그림자 섞기는 저장만 |
| 7직업 전 스킬, 몬스터 AI, 챔피언·유니크·미니언 접사, 슈퍼유니크, 퀘스트 27개와 보상, NPC 서비스(거래·수리·도박·감정·고용·부활·임뷰·소켓·이름 새기기), 용병(막별·오라·레벨·부활), 룬워드·제작·이더리얼·소켓·충전, 요구치·내구도·탄약, 사망 패널티, 난이도, TC·매직 파인드, 신전·우물·상자·통, 레벨업·스태미나, 자동지도·웨이포인트·포털, 새 판마다 새 지도, 저장, 벨트 칸, 무기 바꾸기 | ✅ | |
| 우버 트리스트럼·디아블로 클론 | ➖ | 1.14d 싱글엔 없음 |

## 3. 다음 작업 후보 (우선순위)
1. 맨손 공격 버그, 래더 전용 룬워드 버그 — 작고 원작과 바로 다름
2. 상태 걸림 그림·소리, 몬스터 스킬 소리, 발소리 무게·달리기, "마을에선 안 돼" 대사 — 타격감 후속
3. 비밀 소 레벨
4. `/players X`와 채팅 명령
5. 하드코어
6. 유니크 오라, 유령 챔피언 반투명, 색 있는 빛
7. 감마 옵션, 도움말 화면, 스킬 단축키 16개
8. 시네마틱 (영상 해독기 필요)
