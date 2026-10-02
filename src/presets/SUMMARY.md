# 개발용 프리셋 캐릭터 (99레벨, 클래식 5 + 확장팩 2)

`npx tsx scripts/gen-presets.ts` 가 원작 표에서 만든다. 개발 서버에서 `?preset=<직업>` 으로 Hell Act 1 마을에서 바로 시작, `?preset=all` 은 캐릭터 목록에 7개를 넣는다. 어쌔신·드루이드는 확장팩 캐릭터라 확장팩 MPQ 를 넣었을 때만 보인다.

## Amazon — Lightning Javazon (`?preset=amazon`, Preset-Amazon)

- 스탯: 힘 1000 · 민첩 1000 · 활력 1000 · 에너지 1000 (투자: 힘 +980, 민첩 +975, 활력 +980)
- 장비 포함: 생명 3341 · 마나 2099 · 저항 불/냉/번/독 75/75/75/75 (Normal 기준) · 막기 75%
- 스킬: Magic Arrow 20, Fire Arrow 20, Inner Sight 20, Critical Strike 20, Jab 20, Cold Arrow 20, Multiple Shot 20, Dodge 20, Power Strike 20, Poison Javelin 20, Exploding Arrow 20, Slow Missiles 20, Avoid 20, Impale 20, Lightning Bolt 20, Ice Arrow 20, Guided Arrow 20, Penetrate 20, Charged Strike 20, Plague Javelin 20, Strafe 20, Immolation Arrow 20, Dopplezon 20, Evade 20, Fend 20, Freezing Arrow 20, Valkyrie 20, Pierce 20, Lightning Strike 20, Lightning Fury 20; 나머지 1씩: 
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

- 스탯: 힘 1000 · 민첩 1000 · 활력 1000 · 에너지 1000 (투자: 힘 +990, 민첩 +975, 활력 +990)
- 장비 포함: 생명 2298 · 마나 3301 · 저항 불/냉/번/독 75/75/75/0 (Normal 기준)
- 스킬: Fire Bolt 20, Warmth 20, Charged Bolt 20, Ice Bolt 20, Frozen Armor 20, Inferno 20, Static Field 20, Telekinesis 20, Frost Nova 20, Ice Blast 20, Blaze 20, Fire Ball 20, Nova 20, Lightning 20, Shiver Armor 20, Fire Wall 20, Enchant 20, Chain Lightning 20, Teleport 20, Glacial Spike 20, Meteor 20, Thunder Storm 20, Energy Shield 20, Blizzard 20, Chilling Armor 20, Fire Mastery 20, Hydra 20, Lightning Mastery 20, Frozen Orb 20, Cold Mastery 20; 나머지 1씩: 
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

- 스탯: 힘 1000 · 민첩 1000 · 활력 1000 · 에너지 1000 (투자: 힘 +985, 민첩 +975, 활력 +985)
- 장비 포함: 생명 2342 · 마나 3376 · 저항 불/냉/번/독 75/75/75/50 (Normal 기준) · 막기 75%
- 스킬: Amplify Damage 20, Teeth 20, Bone Armor 20, Skeleton Mastery 20, Raise Skeleton 20, Dim Vision 20, Weaken 20, Poison Dagger 20, Corpse Explosion 20, Clay Golem 20, Iron Maiden 20, Terror 20, Bone Wall 20, Golem Mastery 20, Raise Skeletal Mage 20, Confuse 20, Life Tap 20, Poison Explosion 20, Bone Spear 20, BloodGolem 20, Attract 20, Decrepify 20, Bone Prison 20, Summon Resist 20, IronGolem 20, Lower Resist 20, Poison Nova 20, Bone Spirit 20, FireGolem 20, Revive 20; 나머지 1씩: 
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

- 스탯: 힘 1000 · 민첩 1000 · 활력 1000 · 에너지 1000 (투자: 힘 +975, 민첩 +980, 활력 +975)
- 장비 포함: 생명 3296 · 마나 2519 · 저항 불/냉/번/독 75/75/75/75 (Normal 기준) · 막기 75%
- 스킬: Sacrifice 20, Smite 20, Might 20, Prayer 20, Resist Fire 20, Holy Bolt 20, Holy Fire 20, Thorns 20, Defiance 20, Resist Cold 20, Zeal 20, Charge 20, Blessed Aim 20, Cleansing 20, Resist Lightning 20, Vengeance 20, Blessed Hammer 20, Concentration 20, Holy Freeze 20, Vigor 20, Conversion 20, Holy Shield 20, Holy Shock 20, Sanctuary 20, Meditation 20, Fist of the Heavens 20, Fanaticism 20, Conviction 20, Redemption 20, Salvation 20; 나머지 1씩: 
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

- 스탯: 힘 1000 · 민첩 1000 · 활력 1000 · 에너지 1000 (투자: 힘 +970, 민첩 +980, 활력 +975)
- 장비 포함: 생명 4306 · 마나 1422 · 저항 불/냉/번/독 75/75/75/45 (Normal 기준)
- 스킬: Bash 20, Sword Mastery 20, Axe Mastery 20, Mace Mastery 20, Howl 20, Find Potion 20, Leap 20, Double Swing 20, Pole Arm Mastery 20, Throwing Mastery 20, Spear Mastery 20, Taunt 20, Shout 20, Stun 20, Double Throw 20, Increased Stamina 20, Find Item 20, Leap Attack 20, Concentrate 20, Iron Skin 20, Battle Cry 20, Frenzy 20, Increased Speed 20, Battle Orders 20, Grim Ward 20, Whirlwind 20, Berserk 20, Natural Resistance 20, War Cry 20, Battle Command 20; 나머지 1씩: 
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

## Assassin — Lightning Trapsin (`?preset=assassin`, Preset-Assa)

- 스탯: 힘 1000 · 민첩 1000 · 활력 1000 · 에너지 1000 (투자: 힘 +980, 민첩 +980, 활력 +980)
- 장비 포함: 생명 3477 · 마나 3506 · 저항 불/냉/번/독 70/70/70/75 (Normal 기준) · 막기 75%
- 스킬: Fire Trauma 20, Claw Mastery 20, Psychic Hammer 20, Tiger Strike 20, Dragon Talon 20, Shock Field 20, Blade Sentinel 20, Quickness 20, Fists of Fire 20, Dragon Claw 20, Charged Bolt Sentry 20, Wake of Fire Sentry 20, Weapon Block 20, Cloak of Shadows 20, Cobra Strike 20, Blade Fury 20, Fade 20, Shadow Warrior 20, Claws of Thunder 20, Dragon Tail 20, Lightning Sentry 20, Inferno Sentry 20, Mind Blast 20, Blades of Ice 20, Dragon Flight 20, Death Sentry 20, Blade Shield 20, Venom 20, Shadow Master 20, Royal Strike 20; 나머지 1씩: 
- 장비:
  - rarm: **Heart of the Oak** (Runeword Flail) — item_fastercastrate 40, item_charged_skill(14468) 6425, item_maxmana_percent 15, item_allskills 3, hpregen 20, fireresist 40, lightresist 40, coldresist 40, poisonresist 40, item_charged_skill(14158) 15420
  - larm: **Lidless Wall** (Unique Grim Shield) — item_lightradius 1, item_allskills 1, item_fastercastrate 20, item_manaafterkill 5, item_armor_percent 130, energy 10, item_maxmana_percent 10
  - head: **Harlequin Crest** (Unique Shako) — item_allskills 2, item_hp_perlevel(12) 12, item_mana_perlevel(12) 12, item_magicbonus 50, damageresist 10, strength 2, dexterity 2, vitality 2, energy 2
  - tors: **Enigma** (Runeword Mage Plate) — armorclass 775, item_healafterkill 14, item_fastermovevelocity 45, item_strength_perlevel(6) 6, item_allskills 2, item_find_magic_perlevel(8) 8, item_nonclassskill(54) 1
  - glov: **Magefist** (Unique Light Gauntlets) — item_fastercastrate 20, manarecoverybonus 25, item_elemskill(1) 1, firemindam 1, firemaxdam 6, armorclass 10, item_armor_percent 30
  - belt: **Arachnid Mesh** (Unique Spiderweb Sash) — item_armor_percent 120, item_fastercastrate 20, item_charged_skill(17795) 2827, item_allskills 1, item_slow 10, item_maxmana_percent 5
  - feet: **Sandstorm Trek** (Unique Scarabshell Boots) — item_armor_percent 170, item_fastermovevelocity 20, item_fastergethitrate 20, item_stamina_perlevel(8) 8, item_staminadrainpct 50, poisonresist 70, item_replenish_durability(5) 5, strength 15, vitality 15
  - rrin: **The Stone of Jordan** (Unique ring) — maxmana 20, item_maxmana_percent 25, lightmindam 1, item_allskills 1, lightmaxdam 12
  - lrin: **The Stone of Jordan** (Unique ring) — maxmana 20, item_maxmana_percent 25, lightmindam 1, item_allskills 1, lightmaxdam 12
  - neck: **Mara's Kaleidoscope** (Unique amulet) — item_allskills 2, fireresist 30, lightresist 30, coldresist 30, poisonresist 30, strength 5, dexterity 5, vitality 5, energy 5
- 사양과 다른 점:
  - 래더 전용 룬워드(Spirit·Infinity 등, runes.txt server=1)는 싱글에서 나오지 않아 Heart of the Oak·Enigma 로
  - Enigma 는 소켓 3 이 최대인 Mage Plate (힘 요구치가 가장 낮다)

## Druid — Wind (Tornado/Hurricane) (`?preset=druid`, Preset-Druid)

- 스탯: 힘 1000 · 민첩 1000 · 활력 1000 · 에너지 1000 (투자: 힘 +985, 민첩 +980, 활력 +975)
- 장비 포함: 생명 2364 · 마나 4114 · 저항 불/냉/번/독 75/75/75/75 (Normal 기준) · 막기 75%
- 스킬: Raven 20, Plague Poppy 20, Wearwolf 20, Shape Shifting 20, Firestorm 20, Oak Sage 20, Summon Spirit Wolf 20, Wearbear 20, Molten Boulder 20, Arctic Blast 20, Cycle of Life 20, Feral Rage 20, Maul 20, Eruption 20, Cyclone Armor 20, Heart of Wolverine 20, Summon Fenris 20, Rabies 20, Fire Claws 20, Twister 20, Vines 20, Hunger 20, Shock Wave 20, Volcano 20, Tornado 20, Spirit of Barbs 20, Summon Grizzly 20, Fury 20, Armageddon 20, Hurricane 20; 나머지 1씩: 
- 장비:
  - rarm: **Heart of the Oak** (Runeword Flail) — item_fastercastrate 40, item_charged_skill(14468) 6425, item_maxmana_percent 15, item_allskills 3, hpregen 20, fireresist 40, lightresist 40, coldresist 40, poisonresist 40, item_charged_skill(14158) 15420
  - larm: **Lidless Wall** (Unique Grim Shield) — item_lightradius 1, item_allskills 1, item_fastercastrate 20, item_manaafterkill 5, item_armor_percent 130, energy 10, item_maxmana_percent 10
  - head: **Jalal's Mane** (Unique Totemic Mask) — item_addclassskills(5) 2, item_addskill_tab(16) 2, item_armor_percent 200, item_fastergethitrate 30, item_tohit_percent 20, strength 20, energy 20, item_manaafterkill 5, fireresist 30, lightresist 30, coldresist 30, poisonresist 30
  - tors: **Enigma** (Runeword Mage Plate) — armorclass 775, item_healafterkill 14, item_fastermovevelocity 45, item_strength_perlevel(6) 6, item_allskills 2, item_find_magic_perlevel(8) 8, item_nonclassskill(54) 1
  - glov: **Magefist** (Unique Light Gauntlets) — item_fastercastrate 20, manarecoverybonus 25, item_elemskill(1) 1, firemindam 1, firemaxdam 6, armorclass 10, item_armor_percent 30
  - belt: **Arachnid Mesh** (Unique Spiderweb Sash) — item_armor_percent 120, item_fastercastrate 20, item_charged_skill(17795) 2827, item_allskills 1, item_slow 10, item_maxmana_percent 5
  - feet: **Sandstorm Trek** (Unique Scarabshell Boots) — item_armor_percent 170, item_fastermovevelocity 20, item_fastergethitrate 20, item_stamina_perlevel(8) 8, item_staminadrainpct 50, poisonresist 70, item_replenish_durability(5) 5, strength 15, vitality 15
  - rrin: **The Stone of Jordan** (Unique ring) — maxmana 20, item_maxmana_percent 25, lightmindam 1, item_allskills 1, lightmaxdam 12
  - lrin: **The Stone of Jordan** (Unique ring) — maxmana 20, item_maxmana_percent 25, lightmindam 1, item_allskills 1, lightmaxdam 12
  - neck: **Mara's Kaleidoscope** (Unique amulet) — item_allskills 2, fireresist 30, lightresist 30, coldresist 30, poisonresist 30, strength 5, dexterity 5, vitality 5, energy 5
- 사양과 다른 점:
  - 래더 전용 룬워드(Spirit·Infinity 등, runes.txt server=1)는 싱글에서 나오지 않아 Heart of the Oak·Enigma 로
