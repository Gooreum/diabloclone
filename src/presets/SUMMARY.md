# 개발용 프리셋 캐릭터 (99레벨, 클래식)

`npx tsx scripts/gen-presets.ts` 가 원작 표에서 만든다. 개발 서버에서 `?preset=<직업>` 으로 Hell Act 1 마을에서 바로 시작, `?preset=all` 은 캐릭터 목록에 5개를 넣는다.

## Amazon — Lightning Javazon (`?preset=amazon`, Preset-Amazon)

- 스탯: 힘 70 · 민첩 55 · 활력 445 · 에너지 15 (투자: 힘 +50, 민첩 +30, 활력 +425)
- 장비 포함: 생명 1676 · 마나 252 · 저항 불/냉/번/독 75/75/75/75 (Normal 기준) · 막기 12%
- 스킬: Power Strike 20, Lightning Bolt 5, Charged Strike 20, Lightning Strike 20, Lightning Fury 20; 나머지 1씩: Magic Arrow, Fire Arrow, Inner Sight, Critical Strike, Jab, Cold Arrow, Multiple Shot, Dodge, Poison Javelin, Exploding Arrow, Slow Missiles, Avoid, Impale, Ice Arrow, Guided Arrow, Penetrate, Plague Javelin, Strafe, Immolation Arrow, Dopplezon, Evade, Fend, Freezing Arrow, Valkyrie, Pierce
- 장비:
  - rarm: **Throwing Spear** (Superior Throwing Spear) — tohit 3, item_mindamage_percent 15, item_maxdamage_percent 15
  - larm: **The Ward** (Unique Gothic Shield) — armorclass 40, magic_damage_reduction 2, strength 10, toblock 10, item_armor_percent 100, fireresist 50, lightresist 50, coldresist 50, poisonresist 50
  - head: **Tarnhelm** (Unique Skull Cap) — item_goldbonus 75, item_magicbonus 50, item_allskills 1
  - tors: **Goldskin** (Unique Full Plate Mail) — item_armor_percent 150, fireresist 35, lightresist 35, coldresist 35, poisonresist 35, item_attackertakesdamage 10, item_lightradius 2, item_goldbonus 100
  - glov: **Beast hand** (Rare Gaunlets(H)) — coldresist 30, fireresist 30, lightresist 30, item_fasterattackrate 10
  - belt: **Nightsmoke** (Unique Belt(M)) — fireresist 10, lightresist 10, coldresist 10, poisonresist 10, item_damagetomana 50, maxmana 20, normal_damage_reduction 2, armorclass 15, item_armor_percent 50
  - feet: **Beast shank** (Rare Plate Boots) — coldresist 40, fireresist 40, lightresist 40, item_fastermovevelocity 30
  - rrin: **Angelic Halo** (Set ring) — hpregen 6, maxhp 20
  - lrin: **The Stone of Jordan** (Unique ring) — maxmana 20, item_maxmana_percent 25, lightmindam 1, item_allskills 1, lightmaxdam 12
  - neck: **Angelic Wings** (Set amulet) — item_lightradius 3, item_damagetomana 20
- 사양과 다른 점:
  - 레어 자벨린 → 상급 Throwing Spear: 클래식은 던지는 무기에 매직·레어 접사가 붙지 않고(ITEMMODS_CanItemHaveMagicAffix), 유니크·세트 자벨린도 없다

## Sorceress — Cold (Blizzard) (`?preset=sorceress`, Preset-Sorc)

- 스탯: 힘 100 · 민첩 25 · 활력 425 · 에너지 35 (투자: 힘 +90, 민첩 +0, 활력 +415)
- 장비 포함: 생명 1148 · 마나 406 · 저항 불/냉/번/독 75/75/75/0 (Normal 기준)
- 스킬: Ice Blast 20, Glacial Spike 20, Blizzard 20, Frozen Orb 20, Cold Mastery 5; 나머지 1씩: Fire Bolt, Warmth, Charged Bolt, Ice Bolt, Frozen Armor, Inferno, Static Field, Telekinesis, Frost Nova, Blaze, Fire Ball, Nova, Lightning, Shiver Armor, Fire Wall, Enchant, Chain Lightning, Teleport, Meteor, Thunder Storm, Energy Shield, Chilling Armor, Fire Mastery, Hydra, Lightning Mastery
- 장비:
  - rarm: **The Iron Jang Bong** (Unique War Staff) — armorclass 30, item_fastercastrate 20, item_mindamage_percent 100, item_maxdamage_percent 100, item_tohit_percent 50, item_singleskill(48) 2, item_singleskill(46) 2, item_singleskill(44) 3, item_addclassskills(1) 2
  - head: **Tarnhelm** (Unique Skull Cap) — item_goldbonus 75, item_magicbonus 50, item_allskills 1
  - tors: **Beast hide** (Rare Ancient Armor) — coldresist 30, fireresist 30, lightresist 30, maxhp 60
  - glov: **Magefist** (Unique Light Gauntlets) — item_fastercastrate 20, manarecoverybonus 25, item_elemskill(1) 1, firemindam 1, firemaxdam 6, armorclass 10, item_armor_percent 30
  - belt: **Beast clasp** (Rare Girdle(H)) — coldresist 30, fireresist 30, lightresist 30, maxhp 60
  - feet: **Beast shank** (Rare Plate Boots) — coldresist 40, fireresist 40, lightresist 40, item_fastermovevelocity 30
  - rrin: **The Stone of Jordan** (Unique ring) — maxmana 20, item_maxmana_percent 25, lightmindam 1, item_allskills 1, lightmaxdam 12
  - lrin: **The Stone of Jordan** (Unique ring) — maxmana 20, item_maxmana_percent 25, lightmindam 1, item_allskills 1, lightmaxdam 12
  - neck: **The Eye of Etlich** (Unique amulet) — armorclass_vs_missile 40, item_lightradius 5, item_allskills 1, lifedrainmindam 7, coldmindam 2, coldmaxdam 5, coldlength 250
- 사양과 다른 점:
  - 레어 지팡이 → The Iron Jang Bong (사용자 선택), 방패 없음: 클래식 지팡이는 모두 양손이라 The Ward 를 함께 들 수 없다

## Necromancer — Skeleton Summoner (`?preset=necromancer`, Preset-Necro)

- 스탯: 힘 90 · 민첩 25 · 활력 445 · 에너지 25 (투자: 힘 +75, 민첩 +0, 활력 +430)
- 장비 포함: 생명 1232 · 마나 451 · 저항 불/냉/번/독 75/75/75/50 (Normal 기준) · 막기 2%
- 스킬: Skeleton Mastery 20, Raise Skeleton 20, Corpse Explosion 20, Raise Skeletal Mage 20, Summon Resist 5; 나머지 1씩: Amplify Damage, Teeth, Bone Armor, Dim Vision, Weaken, Poison Dagger, Clay Golem, Iron Maiden, Terror, Bone Wall, Golem Mastery, Confuse, Life Tap, Poison Explosion, Bone Spear, BloodGolem, Attract, Decrepify, Bone Prison, IronGolem, Lower Resist, Poison Nova, Bone Spirit, FireGolem, Revive
- 장비:
  - rarm: **Umes Lament** (Unique Grim Wand) — item_addclassskills(2) 2, maxmana 40, item_fastercastrate 20, item_howl 64, item_singleskill(77) 3, item_singleskill(87) 2
  - larm: **The Ward** (Unique Gothic Shield) — armorclass 40, magic_damage_reduction 2, strength 10, toblock 10, item_armor_percent 100, fireresist 50, lightresist 50, coldresist 50, poisonresist 50
  - head: **Tarnhelm** (Unique Skull Cap) — item_goldbonus 75, item_magicbonus 50, item_allskills 1
  - tors: **Beast hide** (Rare Ancient Armor) — coldresist 30, fireresist 30, lightresist 30, maxhp 60
  - glov: **Magefist** (Unique Light Gauntlets) — item_fastercastrate 20, manarecoverybonus 25, item_elemskill(1) 1, firemindam 1, firemaxdam 6, armorclass 10, item_armor_percent 30
  - belt: **Beast clasp** (Rare Girdle(H)) — coldresist 30, fireresist 30, lightresist 30, maxhp 60
  - feet: **Beast shank** (Rare Plate Boots) — coldresist 40, fireresist 40, lightresist 40, item_fastermovevelocity 30
  - rrin: **The Stone of Jordan** (Unique ring) — maxmana 20, item_maxmana_percent 25, lightmindam 1, item_allskills 1, lightmaxdam 12
  - lrin: **The Stone of Jordan** (Unique ring) — maxmana 20, item_maxmana_percent 25, lightmindam 1, item_allskills 1, lightmaxdam 12
  - neck: **The Eye of Etlich** (Unique amulet) — armorclass_vs_missile 40, item_lightradius 5, item_allskills 1, lifedrainmindam 7, coldmindam 2, coldmaxdam 5, coldlength 250
- 사양과 다른 점:
  - 레어 완드 → Ume's Lament (사용자: 레어보다 좋은 유니크로) — 네크로 +2·시전 20% 로 레어 최대치와 같고 Terror +3·Decrepify +2 가 더 있다

## Paladin — Hammerdin (`?preset=paladin`, Preset-Pala)

- 스탯: 힘 70 · 민첩 281 · 활력 224 · 에너지 15 (투자: 힘 +45, 민첩 +261, 활력 +199)
- 장비 포함: 생명 968 · 마나 303 · 저항 불/냉/번/독 75/75/75/75 (Normal 기준) · 막기 75%
- 스킬: Blessed Aim 20, Blessed Hammer 20, Concentration 20, Vigor 20, Holy Shield 5; 나머지 1씩: Sacrifice, Smite, Might, Prayer, Resist Fire, Holy Bolt, Holy Fire, Thorns, Defiance, Resist Cold, Zeal, Charge, Cleansing, Resist Lightning, Vengeance, Holy Freeze, Conversion, Holy Shock, Sanctuary, Meditation, Fist of the Heavens, Fanaticism, Conviction, Redemption, Salvation
- 장비:
  - rarm: **Beast star** (Rare War Scepter) — item_addclassskills(3) 2, item_fastercastrate 10
  - larm: **The Ward** (Unique Gothic Shield) — armorclass 40, magic_damage_reduction 2, strength 10, toblock 10, item_armor_percent 100, fireresist 50, lightresist 50, coldresist 50, poisonresist 50
  - head: **Tarnhelm** (Unique Skull Cap) — item_goldbonus 75, item_magicbonus 50, item_allskills 1
  - tors: **Goldskin** (Unique Full Plate Mail) — item_armor_percent 150, fireresist 35, lightresist 35, coldresist 35, poisonresist 35, item_attackertakesdamage 10, item_lightradius 2, item_goldbonus 100
  - glov: **Magefist** (Unique Light Gauntlets) — item_fastercastrate 20, manarecoverybonus 25, item_elemskill(1) 1, firemindam 1, firemaxdam 6, armorclass 10, item_armor_percent 30
  - belt: **Beast clasp** (Rare Girdle(H)) — coldresist 30, fireresist 30, lightresist 30, maxhp 60
  - feet: **Beast shank** (Rare Plate Boots) — coldresist 40, fireresist 40, lightresist 40, item_fastermovevelocity 30
  - rrin: **The Stone of Jordan** (Unique ring) — maxmana 20, item_maxmana_percent 25, lightmindam 1, item_allskills 1, lightmaxdam 12
  - lrin: **The Stone of Jordan** (Unique ring) — maxmana 20, item_maxmana_percent 25, lightmindam 1, item_allskills 1, lightmaxdam 12
  - neck: **The Eye of Etlich** (Unique amulet) — armorclass_vs_missile 40, item_lightradius 5, item_allskills 1, lifedrainmindam 7, coldmindam 2, coldmaxdam 5, coldlength 250
- 사양과 다른 점:
  - 레어 셉터 유지 — 클래식 유니크 셉터(Rusthandle +1, Stormeye, Knell Striker)는 +2 레어보다 못하다
  - 셉터 시전속도는 최대 10% (of the Apprentice): of the Magus 는 셉터 제외(etype scep), 옛 행은 frequency 0 이라 나오지 않는다

## Barbarian — Whirlwind (`?preset=barbarian`, Preset-Barb)

- 스탯: 힘 80 · 민첩 20 · 활력 480 · 에너지 10 (투자: 힘 +50, 민첩 +0, 활력 +455)
- 장비 포함: 생명 2226 · 마나 185 · 저항 불/냉/번/독 75/75/75/45 (Normal 기준)
- 스킬: Mace Mastery 20, Shout 5, Battle Orders 20, Whirlwind 20, Battle Command 20; 나머지 1씩: Bash, Sword Mastery, Axe Mastery, Howl, Find Potion, Leap, Double Swing, Pole Arm Mastery, Throwing Mastery, Spear Mastery, Taunt, Stun, Double Throw, Increased Stamina, Find Item, Leap Attack, Concentrate, Iron Skin, Battle Cry, Frenzy, Increased Speed, Grim Ward, Berserk, Natural Resistance, War Cry
- 장비:
  - rarm: **Steeldriver** (Unique Great Maul) — item_req_percent -50, item_fasterattackrate 40, staminarecoverybonus 25, item_mindamage_percent 250, item_maxdamage_percent 250
  - head: **Tarnhelm** (Unique Skull Cap) — item_goldbonus 75, item_magicbonus 50, item_allskills 1
  - tors: **Goldskin** (Unique Full Plate Mail) — item_armor_percent 150, fireresist 35, lightresist 35, coldresist 35, poisonresist 35, item_attackertakesdamage 10, item_lightradius 2, item_goldbonus 100
  - glov: **Beast hand** (Rare Gaunlets(H)) — tohit 20, coldresist 30, fireresist 30, item_fasterattackrate 10
  - belt: **Nightsmoke** (Unique Belt(M)) — fireresist 10, lightresist 10, coldresist 10, poisonresist 10, item_damagetomana 50, maxmana 20, normal_damage_reduction 2, armorclass 15, item_armor_percent 50
  - feet: **Beast shank** (Rare Plate Boots) — coldresist 40, fireresist 40, lightresist 40, item_fastermovevelocity 30
  - rrin: **Angelic Halo** (Set ring) — hpregen 6, maxhp 20
  - lrin: **The Stone of Jordan** (Unique ring) — maxmana 20, item_maxmana_percent 25, lightmindam 1, item_allskills 1, lightmaxdam 12
  - neck: **Angelic Wings** (Set amulet) — item_lightradius 3, item_damagetomana 20
- 사양과 다른 점:
  - Bonesnap → Steeldriver: Bonesnap 은 확장팩 전용(클래식 uniqueitems 에 없음). 사용자: 레어보다 좋은 유니크로 (공속 40·대미지 +250%·요구치 −50%)
