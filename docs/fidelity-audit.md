# 원작 대비 전수 검토 (Diablo II 1.14d 싱글)

2026-10-03 기준이다. 근거는 코드 위치(`파일:줄`), 원작 표 열(MPQ 안 `data\global\excel\*.txt`), 원작 역분석 코드 D2MOO(1.10f)다.

- 상태: ✅ 원작과 같음 · 🟡 부분/근사 · ❌ 없음 · ➖ 싱글엔 원래 없음
- "이번에"는 `feature/hit-feel`, "조작 수정"은 `fix/play-controls`에서 고친 것이다.
- D2MOO는 1.10 서버·공통 코드다. 1.14d에서 바뀐 수치와 클라이언트(클릭·화면·소리) 동작은 거기에 없어서, 그런 곳은 "미확인"으로 적는다.
- 짐작으로 맞춘 곳 전체 목록은 [fidelity-approximations.md](fidelity-approximations.md)에 있다 (코드 주석에서 자동 생성).

## 0. 조작·전투 반응 (사용자 신고 → 재현 → 수정)

| 항목 | 상태 | 근거 / 원작 동작 |
|---|---|---|
| 시체·오브젝트·NPC 위 우클릭 | ✅ 조작 수정 | 살아 있는 몬스터가 아니면 클릭한 자리로 시전 (`game.ts driveSkillAction`). 전에는 스킬을 조용히 취소했다 |
| 오른쪽 클릭 근접 스킬 | ✅ 조작 수정 | 멀리 있는 대상에게 걸어가서 친다, Shift 면 제자리 (`useSkill.standStill`). 전에는 제자리에서 허공을 쳤다 |
| 공격 되풀이 | ✅ 조작 수정 | 버튼을 누르고 있는 동안만 (`release` 명령). 누른 채 대상이 죽으면 커서 아래 다음 대상 |
| 동작 중 이동·말 걸기 클릭 | 🟡 조작 수정 | 동작이 끝나는 틱에 실행 (`PlayerState.pending`). 누르고 있는 경우는 원작과 같다. **한 번만 누른 클릭을 기억하는 것은 미확인** (원작 클라이언트 소스 없음, 서버 `sub_6FC817D0`은 거절한 요청을 버린다) |
| 유닛 충돌·길찾기 | ✅ 조작 수정 | 원작 발자국: 작은 유닛은 가운데 칸, 큰 유닛은 십자 5칸이 `COLLIDE_NO_PATH`, 플레이어는 자기 칸+사방 4칸으로 검사 (`D2Collision.cpp COLLISION_SetMaskWithPattern`). 소환수·말 못 거는 마을 유닛은 지나간다 |
| 가다 막히면 다시 길찾기 | 🟡 조작 수정 | 5틱 간격 최대 4번. **세 번째부터 마을 NPC를 지나가는 것은 원작과 다름** (사용자 요청: 마을에서 멈추지 않게) |
| 플레이어 길찾기 범위 | 🟡 | 원작은 직선 → 18칸 안이면 A* (`PathMisc.cpp:601`). 여기는 맵 전체 A* |
| 막기 동작 간격 | ✅ 조작 수정 | 마지막 막기 동작에서 15 + FBR/8 프레임 (`SUnitDmg.cpp:2005`) |
| 피격 경직 규칙 | 🟡 조작 수정 | 원본 `sub_6FCC1870` (히트클래스별 제수 8/16/32/64). **1.14d 수치는 미확인** (D2MOO는 1.10) |
| 맞으면 동작 끊김 | ✅ 조작 수정 | skills.txt `interrupt` 가 있는 스킬만 (`PlrModes.cpp sub_6FC81890`·`First_6FC7F340`). Whirlwind·Charge·Leap 중에는 안 끊는 것은 근사 |
| 공격 속도 | ✅ 조작 수정 | `animspeed.ts` — EIAS + 100 − WSM + 스킬·오라 attackrate, 양손 평균, 시퀀스 −30, 15..175 (`Units.cpp UNITS_UpdateAttackAnimRateAndVelocity`). 전에는 늑대인간·광신·프렌지·버스트 오브 스피드·냉기 감속이 무시됐다 |
| 변신(늑대·곰) 공격 속도 | 🟡 조작 수정 | 무기 속도 기반 변신 공식 (`D2Common_11043`, `ITEMS_GetWeaponAttackSpeed`). 기준 프레임을 서 있는 동작(늑대 9·곰 10)으로 본 것, 변신 중 공격 rate 판정(D2MOO는 역분석 오류로 보임)은 **미확인** |
| 시전 속도·시작 프레임 | ✅ 조작 수정 | 시전 rate 상한 175, 아마존·소서리스 A1·A2 시작 프레임 (`UNITS_GetFrameBonus`). 원작 표와 대조: 소서리스 FCR 0/9/20/37/63/105/200 → 13/12/11/10/9/8/7 프레임 |
| 피격 동작 속도 | 🟡 | 50 + EFHR (알려진 원작 표와 일치). D2MOO 식은 역분석 오류로 보여 쓰지 않음 |
| 투창·화살 수량 0 | ✅ 조작 수정 | 일반 등급은 없어지고 가방의 같은 묶음 자동 장착(itemtypes `Reload`), 매직 이상 무기는 부서짐으로 남음 (`PlrModes.cpp sub_6FC80B90`). `ReEquip`(던지는 물약 뒤 원래 무기)은 ❌ |
| 반복 소리 정리 | ✅ 조작 수정 | 효과음은 미사일 TravelSound만 반복, 레벨 이동 때 정리 (`audio/sound.ts`). 전에는 Wake of Inferno 소리가 마을까지 영원히 남았다 |
| 쓸 수 없는 스킬 빨간 아이콘·맨손 공격 | ✅ | `game.ts skillUseState` (원작 `SKILLS_GetUseState`), `weaponAllows` 맨손 규칙 (`sub_6FDB1130`) |
| 인벤토리 Shift+클릭 → 벨트 | ✅ 조작 수정 | `toBelt` 명령 (`PlrMsg.cpp Rcv0x63_ShiftLeftClickItemToBelt`). 커서에 든 게 있으면 거부, 칸은 아래 규칙. 전에는 아무 일도 없었다. **벨트 아이템을 Shift+클릭해 인벤토리로 보내는 조작은 원작 유무 미확인이라 없음** |
| 벨트 칸 고르기 (줍기·Shift+클릭) | ✅ 조작 수정 | 아래 줄의 같은 종류(생명끼리·마나끼리·회복끼리) 물약 열 위로, 없으면 items.txt `autobelt` 품목만 아래 줄 첫 빈칸 (`INVENTORY_GetFreeBeltSlot`, `ITEMS_ComparePotionTypes`). 주울 때는 `autobelt` 또는 같은 종류가 벨트에 있을 때만 (`ITEMS_CheckIfAutoBeltable`, 두루마리 제외). 전에는 첫 빈칸 |
| 두루마리 → 책 | ✅ 조작 수정 | 커서의 두루마리를 책 위에 클릭하면 +1 (`Rcv0x29_ScrollToBook`), 주우면 수량이 남은 책으로 (`ItemMode.cpp:1173`, `INVENTORY_FindFillableBook`), 책을 주우면 가진 책에 합치고 넘치면 땅에 나머지 (`sub_6FC43BF0`). 책이 꽉 찼을 때 클릭은 원작 서버처럼 아무 일도 없음 (클라이언트가 그 뒤 자리 바꾸기를 보내는지 미확인) |
| 같은 묶음 합치기 | ✅ 조작 수정 | 커서의 열쇠·화살·투창을 같은 코드·등급·소켓 없음·이더리얼 같음인 묶음 위에 클릭하면 합치고 넘치면 커서에 나머지 (`Rcv0x21_StackItems`, `ITEMS_AreStackablesEqual`). 주울 때 자동 합치기(`autostack` 열, `sub_6FC437F0`)는 ❌ (items.txt 파서에 없음) |

### 7직업 전 스킬 실제 클릭 검사 (`e2e/class-play.spec.ts`)
스킬 버튼으로 고르고, Hell 필드에서 진짜 마우스 오른쪽 클릭으로 몬스터 위·시체 위·빈 땅을 누른다. 시전 시작, 효과(미사일·소환·상태·피해), 시전 뒤 이동 클릭을 본다.

| 직업 | 스킬 수 | 실패 |
|---|---|---|
| 아마존 | 24 | 0 |
| 소서리스 | 26 | 0 |
| 네크로맨서 | 27 | 0 |
| 팔라딘 | 30 | 0 |
| 바바리안 | 20 | 0 |
| 드루이드 | 29 | 0 |
| 어쌔신 | 28 | 0 |

- 이 검사가 보는 것은 "눌렀을 때 나가는가, 효과가 생기는가"까지다. 피해량·범위·지속 시간이 원작 수치와 같은지는 이 검사로 확인되지 않는다 (그건 스킬별 단위 테스트와 아래 근사 목록의 몫).
- 공통 검사 (`e2e/play-controls.spec.ts`): 시체 위 우클릭, 군중 속 우클릭 40번 × 4직업 전부 시전, 공격 중 이동, 마을 NPC 통과. `e2e/sound-loops.spec.ts`: 전 스킬 사용 뒤 남는 반복 소리 0.

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
| 맨손 공격 | ✅ | `game.ts weaponAllows` — itypeA 첫 칸이 weap·mele·h2h 면 맨손 가능 (D2MOO `sub_6FDB1130`) |
| 비밀 소 레벨 (Wirt 다리 + TP 책 큐브) | ❌ | 실패로 처리 (`game.ts:10182`), Moo Moo Farm 없음 |
| `/players X` | ❌ | 몬스터 생명·경험치·드롭이 1인 기준 (`treasure.ts:195`) |
| 채팅 입력·명령 (`/players`, `/nopickup`) | ❌ | |
| 하드코어 | ❌ | 칭호 함수만 있음 (`difficulty.ts:123`) |
| 래더 전용 룬워드 | ❌ 버그 | runes.txt `server=1`(Spirit·Infinity·Insight 등)도 싱글에서 완성됨 (`runewords.ts:27`) |
| Valkyrie 장비 | 🟡 | 장비 굴림 생략 (`game.ts:3694`) |
| 큐브 조합 `op` 1~14 행 | 🟡 | 건너뜀 (`cube.ts:397`) |
| 화살·투창 자동 장착 | 🟡 | 다 쓰면 가방의 같은 묶음 자동 장착은 ✅ (`game.ts decQuantity`). 상점에서 살 때 빈 손에 바로 장착은 생략 (`npc.ts:335`) |
| 시체 여러 개 | 🟡 | 하나로 합침 (`game.ts:820`) — 원작은 15개까지 |
| 보관함 금화 한도 | 🟡 | 레벨 공식 근사 (`game.ts:1571`) |
| 그 밖의 오브젝트 (무기 거치대 등) | 🟡 | 일반 상자 드롭으로 (`game.ts:11402`) |
| Act 5 용병 초상 | 🟡 | 로그 초상으로 대신 (`hireling.ts:128`) |
| 세트 보너스 | 🟡 | 개수 기준, `addFunc` 단순화 (`charstats.ts:65`) |
| 단축키 | 🟡 | 도움말(H)·채팅(Enter)·화면 지우기(Space)·휠 스킬 넘기기·스킬 단축키 16개 없음 (8개) |
| 옵션 | 🟡 | 감마·대비 없음, 조명 품질·그림자 섞기는 저장만 |
| 7직업 전 스킬, 몬스터 AI, 챔피언·유니크·미니언 접사, 슈퍼유니크, 퀘스트 27개와 보상, NPC 서비스(거래·수리·도박·감정·고용·부활·임뷰·소켓·이름 새기기), 용병(막별·오라·레벨·부활), 룬워드·제작·이더리얼·소켓·충전, 요구치·내구도·탄약, 사망 패널티, 난이도, TC·매직 파인드, 신전·우물·상자·통, 레벨업·스태미나, 자동지도·웨이포인트·포털, 새 판마다 새 지도, 저장, 벨트 칸, 무기 바꾸기 | ✅ | |
| 우버 트리스트럼·디아블로 클론 | ➖ | 1.14d 싱글엔 없음 |

## 3. 짐작으로 맞춘 곳 ("근사") 정리
[fidelity-approximations.md](fidelity-approximations.md)에 전체 목록이 있다 (`node scripts/list-approximations.mjs`).

| 영역 | 개수 | 플레이에 보이는가 | 다음 처리 |
|---|---|---|---|
| 전투·스킬·이동 (`engine/game.ts`) | 161 | 보임 (동작이 달라짐) | **1순위** — 스킬별로 D2MOO `SKILLS_SrvDo*`와 대조 |
| 몬스터·NPC 판단 (`engine/ai`) | 27 | 보임 | 2순위 — `AiThink.cpp` 대조 |
| 그 밖의 엔진 (상점·용병·스탯·유니크·조명) | 56 | 일부 보임 | 3순위 |
| 퀘스트 진행·대사 연결 | 43 | 일부 보임 | 대사 연결은 클라이언트 표가 없어 대부분 확인 불가 |
| 맵 생성 (DRLG) | 23 | 보임 (지형 배치) | D2MOO DRLG 대조 |
| 화면 UI | 77 | 모양만 | 원작 화면 캡처와 비교 |
| 그리기·소리·입력 | 57 | 모양·소리만 | 클라이언트 소스가 없어 실측 필요 |

- 합계 444곳. 한 번에 다 바꾸면 검증이 안 되므로 영역별 묶음으로 계획을 따로 올린다.
- 이번에 없앤 것: 변신 공격 속도 근사, 유닛 충돌 반지름 근사.

## 4. 다음 작업 후보 (우선순위)
1. 래더 전용 룬워드 버그 — 작고 원작과 바로 다름
2. `engine/game.ts`의 스킬 근사 161곳을 직업별 묶음으로 원본 대조
3. 상태 걸림 그림·소리, 몬스터 스킬 소리, 발소리 무게·달리기, "마을에선 안 돼" 대사 — 타격감 후속
4. 비밀 소 레벨
5. `/players X`와 채팅 명령
6. 하드코어
7. 유니크 오라, 유령 챔피언 반투명, 색 있는 빛
8. 감마 옵션, 도움말 화면, 스킬 단축키 16개
9. 시네마틱 (영상 해독기 필요)
10. 원작 1.14d 실행 파일(설치본)로 실측해 "미확인" 항목 확정 — 클릭 기억, 피격 규칙 수치, 변신 속도 기준 프레임
