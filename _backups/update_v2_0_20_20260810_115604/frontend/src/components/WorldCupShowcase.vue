<script setup>
import { computed, onMounted, ref } from "vue";
import {
  Globe2,
  Sparkles,
  Trophy,
  Medal,
  ShieldCheck,
  Flame,
  Users,
  Swords,
  Star,
} from "@lucide/vue";
import { api } from "../services/api";
import { money } from "../utils";
import LoadingBlock from "./LoadingBlock.vue";
import EmptyState from "./EmptyState.vue";

const props = defineProps({ competitionId: { type: Number, required: true } });
const loading = ref(true);
const data = ref(null);
const active = ref("overview");

const themeClass = computed(
  () =>
    `wc-${String(data.value?.profile?.visual_theme || "COSMIC_GOLD")
      .toLowerCase()
      .replaceAll("_", "-")}`,
);
const standingsByGroup = computed(() =>
  Object.fromEntries(
    (data.value?.groups || []).map((group) => [
      group.id,
      (data.value?.standings || []).filter(
        (row) => Number(row.group_id) === Number(group.id),
      ),
    ]),
  ),
);
const qualifiedIds = computed(
  () =>
    new Set((data.value?.qualified || []).map((row) => Number(row.entry_id))),
);
const knockoutRounds = computed(() =>
  (data.value?.rounds || []).map((round) => ({
    ...round,
    matches: (data.value?.matches || []).filter(
      (match) => Number(match.round_id) === Number(round.id),
    ),
  })),
);
const groupFinished = computed(
  () =>
    (data.value?.matches || []).filter(
      (m) => m.stage_type === "GROUP" && m.status === "FINISHED",
    ).length,
);
const knockoutFinished = computed(
  () =>
    (data.value?.matches || []).filter(
      (m) => m.stage_type === "KNOCKOUT" && m.status === "FINISHED",
    ).length,
);

function flag(entry, size = 34) {
  if (entry?.flag_url) return entry.flag_url;
  const code = String(entry?.country_code || "WC")
    .slice(0, 3)
    .toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size * 2}' height='${size * 2}'><defs><linearGradient id='g' x1='0' x2='1'><stop stop-color='#1c315d'/><stop offset='1' stop-color='#0b1734'/></linearGradient></defs><rect width='100%' height='100%' rx='10' fill='url(#g)'/><text x='50%' y='56%' text-anchor='middle' dominant-baseline='middle' font-family='Arial' font-size='${size * 0.72}' font-weight='800' fill='#ffe27c'>${code}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

async function load() {
  loading.value = true;
  try {
    data.value = (
      await api.get(`/competitions/${props.competitionId}/world-cup`, null, {
        auth: false,
      })
    ).data;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <LoadingBlock v-if="loading" />
  <section v-else-if="data" class="world-cup-shell" :class="themeClass">
    <div class="star-field" aria-hidden="true">
      <i
        v-for="n in 32"
        :key="n"
        :style="{
          '--i': n,
          left: `${(n * 37) % 100}%`,
          top: `${(n * 61) % 100}%`,
        }"
      />
    </div>

    <header class="world-cup-hero">
      <div class="orb"><Globe2 :size="48" /></div>
      <div class="hero-copy">
        <span class="world-label"
          ><Sparkles :size="14" /> World Cup 48 Experience</span
        >
        <h1>{{ data.profile.competition_name }}</h1>
        <p>
          {{ data.profile.season_name }} · 48 quốc gia · 12 bảng · 104 trận tối
          đa
        </p>
        <div class="hero-pills">
          <span
            ><Users :size="14" /> {{ data.entries.length }}/48 quốc gia</span
          >
          <span
            ><Swords :size="14" /> {{ groupFinished }}/72 trận vòng bảng</span
          >
          <span
            ><Trophy :size="14" /> Hệ số x{{ data.profile.coefficient }}</span
          >
        </div>
      </div>
      <div class="world-cup-trophy">
        <Trophy :size="58" />
        <small>Global Championship</small>
      </div>
    </header>

    <nav class="world-tabs">
      <button
        v-for="tab in [
          ['overview', 'Tổng quan'],
          ['groups', '12 bảng'],
          ['thirds', 'Hạng ba tốt nhất'],
          ['bracket', 'Nhánh 32 đội'],
          ['matches', 'Trận đấu'],
          ['honours', 'Vinh danh'],
        ]"
        :key="tab[0]"
        :class="{ active: active === tab[0] }"
        @click="active = tab[0]"
      >
        {{ tab[1] }}
      </button>
    </nav>

    <section v-if="active === 'overview'" class="overview-grid">
      <article class="world-card podium-card">
        <span class="section-kicker"><Medal :size="14" /> Podium</span>
        <h2>Những quốc gia xuất sắc nhất</h2>
        <EmptyState
          v-if="!data.results.length"
          message="Podium sẽ sáng lên sau trận chung kết."
        />
        <div v-else class="podium">
          <div
            v-for="result in data.results.slice(0, 3)"
            :key="result.id"
            :class="`place-${result.placement}`"
          >
            <span class="medal-icon">{{
              result.placement === 1
                ? "🥇"
                : result.placement === 2
                  ? "🥈"
                  : "🥉"
            }}</span>
            <img :src="flag(result, 48)" :alt="result.country_name" />
            <b>{{ result.country_name }}</b>
            <small>{{ result.player_name }}</small>
          </div>
        </div>
      </article>

      <article class="world-card">
        <span class="section-kicker"><Flame :size="14" /> Giant Killers</span>
        <h2>Đội hạ nhà vô địch</h2>
        <EmptyState
          v-if="!data.upsetRewards.length"
          message="Chưa có bất ngờ lịch sử."
        />
        <div v-else class="upset-list">
          <div v-for="reward in data.upsetRewards" :key="reward.id">
            <Flame :size="20" />
            <span
              ><b>{{ reward.winning_country_name }}</b> đánh bại
              {{ reward.defeated_country_name }}</span
            >
            <strong>+{{ reward.awarded_points }} điểm</strong>
          </div>
        </div>
      </article>

      <article class="world-card entries-card">
        <span class="section-kicker"><Globe2 :size="14" /> Nations</span>
        <h2>48 đại diện quốc gia</h2>
        <div class="country-grid">
          <div v-for="entry in data.entries" :key="entry.id">
            <img :src="flag(entry)" :alt="entry.country_name" />
            <span
              ><b>{{ entry.country_name }}</b
              ><small>{{ entry.player_name }}</small></span
            >
            <em>#{{ entry.seed_rank || "—" }}</em>
          </div>
        </div>
      </article>
    </section>

    <section v-else-if="active === 'groups'" class="groups-grid">
      <article
        v-for="group in data.groups"
        :key="group.id"
        class="world-card group-card"
      >
        <header>
          <span>{{ group.group_code }}</span>
          <div>
            <small>WORLD CUP</small>
            <h3>{{ group.display_name }}</h3>
          </div>
        </header>
        <div class="standing-head">
          <span>#</span><span>Quốc gia</span><span>Đ</span><span>HS</span
          ><span>Đ</span>
        </div>
        <div
          v-for="row in standingsByGroup[group.id] || []"
          :key="row.entry_id"
          class="standing-row"
          :class="{
            qualified: qualifiedIds.has(Number(row.entry_id)),
            third: Number(row.group_rank) === 3,
          }"
        >
          <b>{{ row.group_rank }}</b>
          <span class="nation"
            ><img :src="flag(row, 28)" /><span>{{
              row.country_name
            }}</span></span
          >
          <span>{{ row.played }}</span
          ><span
            >{{ row.goal_difference > 0 ? "+" : ""
            }}{{ row.goal_difference }}</span
          ><strong>{{ row.points }}</strong>
        </div>
      </article>
    </section>

    <section v-else-if="active === 'thirds'" class="world-card">
      <div class="section-header">
        <div>
          <span class="section-kicker"
            ><ShieldCheck :size="14" /> Best Third</span
          >
          <h2>8 đội hạng ba tốt nhất</h2>
        </div>
        <p>
          So sánh theo điểm, hiệu số, bàn thắng, số trận thắng và hạt giống.
        </p>
      </div>
      <div class="table-wrap special-table">
        <table>
          <thead>
            <tr>
              <th>Hạng</th>
              <th>Quốc gia</th>
              <th>Bảng</th>
              <th>Điểm</th>
              <th>Hiệu số</th>
              <th>Bàn thắng</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, index) in data.bestThirds"
              :key="row.entry_id"
              :class="{ qualified: index < 8 }"
            >
              <td>
                <b>#{{ index + 1 }}</b>
              </td>
              <td>
                <span class="nation"
                  ><img :src="flag(row, 30)" /><b>{{
                    row.country_name
                  }}</b></span
                >
              </td>
              <td>Bảng {{ row.group_code }}</td>
              <td>{{ row.points }}</td>
              <td>
                {{ row.goal_difference > 0 ? "+" : ""
                }}{{ row.goal_difference }}
              </td>
              <td>{{ row.goals_for }}</td>
              <td>
                <span
                  class="qualify-badge"
                  :class="index < 8 ? 'go' : 'wait'"
                  >{{ index > 7 ? "Bị loại" : "Vào vòng 32" }}</span
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else-if="active === 'bracket'" class="world-bracket-wrap">
      <EmptyState
        v-if="!knockoutRounds.length"
        message="Nhánh 32 đội sẽ xuất hiện sau khi chốt vòng bảng."
      />
      <div v-else class="world-bracket">
        <section
          v-for="round in knockoutRounds"
          :key="round.id"
          class="round-column"
        >
          <header>
            <small>Knockout</small>
            <h3>{{ round.round_name }}</h3>
          </header>
          <article
            v-for="match in round.matches"
            :key="match.id"
            class="world-match"
            :class="{ upset: match.highlighted_upset }"
          >
            <div>
              <span
                ><img
                  :src="
                    flag(
                      {
                        flag_url: match.home_flag_url,
                        country_code: match.home_country_code,
                      },
                      24,
                    )
                  "
                />{{ match.home_country_name || "Chờ xác định" }}</span
              ><b>{{ match.home_score ?? "–" }}</b>
            </div>
            <div>
              <span
                ><img
                  :src="
                    flag(
                      {
                        flag_url: match.away_flag_url,
                        country_code: match.away_country_code,
                      },
                      24,
                    )
                  "
                />{{ match.away_country_name || "Chờ xác định" }}</span
              ><b>{{ match.away_score ?? "–" }}</b>
            </div>
            <Flame v-if="match.highlighted_upset" :size="15" />
          </article>
        </section>
      </div>
    </section>

    <section v-else-if="active === 'matches'" class="world-card">
      <div class="table-wrap special-table">
        <table>
          <thead>
            <tr>
              <th>Giai đoạn</th>
              <th>Trận</th>
              <th>Tỷ số</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="match in data.matches" :key="match.id">
              <td>
                {{
                  match.group_code
                    ? `Bảng ${match.group_code}`
                    : match.round_name
                }}
              </td>
              <td>
                <span class="match-line"
                  ><span>{{ match.home_country_name || "Chờ" }}</span
                  ><em>vs</em><span>{{ match.away_country_name || "Chờ" }}</span
                  ><Flame v-if="match.highlighted_upset" :size="14"
                /></span>
              </td>
              <td>
                <b
                  >{{ match.home_score ?? "–" }} :
                  {{ match.away_score ?? "–" }}</b
                >
              </td>
              <td>{{ match.status }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else class="honour-grid">
      <article class="world-card">
        <span class="section-kicker"><Medal :size="14" /> Team medals</span>
        <h2>Huy chương World Cup</h2>
        <div class="award-list">
          <div v-for="result in data.results.slice(0, 3)" :key="result.id">
            <span>{{
              result.medal_type === "GOLD"
                ? "🥇"
                : result.medal_type === "SILVER"
                  ? "🥈"
                  : "🥉"
            }}</span>
            <div>
              <b>{{ result.country_name }}</b
              ><small
                >{{ result.player_name }} ·
                {{ result.ranking_points }} điểm</small
              >
            </div>
            <strong>{{
              money(
                result.placement === 1
                  ? data.profile.gold_prize_amount
                  : result.placement === 2
                    ? data.profile.silver_prize_amount
                    : data.profile.bronze_prize_amount,
                true,
              )
            }}</strong>
          </div>
        </div>
        <div class="progression-list">
          <div v-for="rule in data.rewardRules" :key="rule.id"><span>{{ rule.placement_label }}</span><b>{{ Number(rule.base_ranking_points) * Number(data.profile.coefficient) }} điểm/người</b></div>
        </div>
      </article>
      <article class="world-card">
        <span class="section-kicker"
          ><Star :size="14" /> Individual honours</span
        >
        <h2>Danh hiệu cá nhân</h2>
        <EmptyState
          v-if="!data.awards.filter((a) => a.category !== 'TEAM_MEDAL').length"
        />
        <div v-else class="award-list">
          <div
            v-for="award in data.awards.filter(
              (a) => a.category !== 'TEAM_MEDAL',
            )"
            :key="award.id"
          >
            <span>🏆</span>
            <div>
              <b>{{ award.award_name }}</b
              ><small
                >{{ award.player_name }} ·
                {{ award.country_name_at_award }}</small
              >
            </div>
            <strong>+{{ award.awarded_points }}</strong>
          </div>
        </div>
      </article>
    </section>
  </section>
</template>

<style scoped>
.world-cup-shell {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border-radius: 28px;
  padding: 26px;
  background:
    radial-gradient(
      circle at 20% 5%,
      rgba(255, 214, 91, 0.18),
      transparent 30%
    ),
    radial-gradient(
      circle at 88% 16%,
      rgba(79, 128, 255, 0.2),
      transparent 34%
    ),
    linear-gradient(145deg, #07101f, #101b35 58%, #07101f);
  border: 1px solid rgba(255, 220, 115, 0.22);
  box-shadow: 0 35px 120px rgba(0, 0, 0, 0.48);
}
.wc-aurora-blue {
  background:
    radial-gradient(circle at 20% 5%, rgba(60, 226, 255, 0.2), transparent 30%),
    radial-gradient(
      circle at 88% 16%,
      rgba(89, 95, 255, 0.25),
      transparent 34%
    ),
    linear-gradient(145deg, #05131f, #102743 58%, #07101f);
}
.wc-royal-purple {
  background:
    radial-gradient(
      circle at 20% 5%,
      rgba(255, 105, 228, 0.18),
      transparent 30%
    ),
    radial-gradient(
      circle at 88% 16%,
      rgba(119, 83, 255, 0.25),
      transparent 34%
    ),
    linear-gradient(145deg, #11081e, #211240 58%, #090714);
}
.star-field {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: -1;
}
.star-field i {
  position: absolute;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: white;
  opacity: calc(0.25 + (var(--i) %5) * 0.12);
  animation: twinkle calc(2s + (var(--i) %4) * 0.7s) ease-in-out infinite
    alternate;
}
@keyframes twinkle {
  to {
    transform: scale(2.4);
    opacity: 1;
    box-shadow: 0 0 12px white;
  }
}
.world-cup-hero {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 22px;
  align-items: center;
  padding: 24px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 22px;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.08),
    rgba(255, 255, 255, 0.025)
  );
  backdrop-filter: blur(18px);
}
.orb {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #ffe27c;
  background: radial-gradient(circle at 35% 30%, #4f79dc, #102552 60%, #051126);
  box-shadow:
    inset -10px -12px 22px rgba(0, 0, 0, 0.4),
    0 0 42px rgba(89, 137, 255, 0.35);
  animation: float 4s ease-in-out infinite;
}
@keyframes float {
  50% {
    transform: translateY(-7px) rotate(3deg);
  }
}
.world-label,
.section-kicker {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #ffe27c;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 11px;
  font-weight: 900;
}
.hero-copy h1 {
  font-size: clamp(32px, 5vw, 62px);
  margin: 8px 0;
  background: linear-gradient(90deg, #fff, #ffe28a, #fff);
  background-size: 200% auto;
  color: transparent;
  background-clip: text;
  animation: shine 5s linear infinite;
}
@keyframes shine {
  to {
    background-position: 200% center;
  }
}
.hero-pills {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 15px;
}
.hero-pills span {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  background: rgba(2, 8, 20, 0.42);
  font-size: 11px;
}
.world-cup-trophy {
  text-align: center;
  color: #ffe27c;
}
.world-cup-trophy small {
  display: block;
  margin-top: 5px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 8px;
}
.world-tabs {
  display: flex;
  gap: 8px;
  overflow: auto;
  margin: 20px 0;
}
.world-tabs button {
  white-space: nowrap;
  padding: 11px 15px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(5, 12, 28, 0.68);
  color: #b9c5dd;
  font-weight: 800;
}
.world-tabs button.active {
  color: #07101f;
  background: linear-gradient(135deg, #ffe27c, #f5b942);
  box-shadow: 0 10px 28px rgba(245, 185, 66, 0.25);
}
.world-card {
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  background: linear-gradient(
    145deg,
    rgba(13, 26, 51, 0.88),
    rgba(5, 12, 27, 0.82)
  );
  box-shadow: 0 18px 55px rgba(0, 0, 0, 0.28);
}
.world-card h2 {
  margin: 7px 0 16px;
}
.overview-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
.entries-card {
  grid-column: 1/-1;
}
.podium {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  align-items: end;
  gap: 10px;
  min-height: 230px;
}
.podium > div {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 18px 10px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.podium .place-1 {
  order: 2;
  min-height: 220px;
  background: linear-gradient(
    180deg,
    rgba(255, 220, 103, 0.18),
    rgba(255, 255, 255, 0.03)
  );
}
.podium .place-2 {
  order: 1;
  min-height: 175px;
}
.podium .place-3 {
  order: 3;
  min-height: 145px;
}
.podium img {
  width: 56px;
  height: 38px;
  object-fit: cover;
  border-radius: 7px;
  margin: 8px;
}
.podium small {
  color: #93a7c4;
  margin-top: 4px;
}
.medal-icon {
  font-size: 30px;
}
.country-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.country-grid > div {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 9px;
  padding: 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.country-grid img,
.nation img,
.world-match img {
  width: 32px;
  height: 22px;
  object-fit: cover;
  border-radius: 5px;
}
.country-grid b,
.country-grid small {
  display: block;
}
.country-grid small {
  color: #8fa4c4;
  font-size: 9px;
  margin-top: 2px;
}
.country-grid em {
  color: #ffe27c;
  font-size: 10px;
}
.upset-list {
  display: grid;
  gap: 9px;
}
.upset-list > div {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 9px;
  padding: 12px;
  border: 1px solid rgba(255, 190, 76, 0.16);
  border-radius: 12px;
  background: rgba(255, 171, 45, 0.07);
}
.upset-list svg,
.upset-list strong {
  color: #ffc85b;
}
.groups-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.group-card header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.group-card header > span {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: linear-gradient(135deg, #ffe27c, #df9a26);
  color: #111;
  font: 900 20px Manrope;
}
.group-card header small {
  color: #7f95b6;
  font-size: 8px;
}
.standing-head,
.standing-row {
  display: grid;
  grid-template-columns: 28px 1fr 35px 42px 35px;
  align-items: center;
  gap: 5px;
  padding: 8px 4px;
}
.standing-head {
  color: #7188a9;
  font-size: 9px;
  text-transform: uppercase;
}
.standing-row {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 11px;
}
.standing-row.qualified {
  background: linear-gradient(90deg, rgba(60, 220, 150, 0.1), transparent);
}
.standing-row.third {
  border-left: 2px solid #ffc857;
}
.nation {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.nation span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.standing-row strong {
  color: #ffe27c;
}
.section-header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-end;
}
.special-table table {
  min-width: 800px;
}
.special-table tr.qualified {
  background: rgba(53, 221, 154, 0.05);
}
.qualify-badge {
  padding: 5px 8px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 900;
}
.qualify-badge.go {
  color: #65e8a8;
  background: rgba(53, 221, 154, 0.1);
}
.qualify-badge.wait {
  color: #ff7f91;
  background: rgba(255, 93, 115, 0.1);
}
.world-bracket-wrap {
  overflow: auto;
  padding-bottom: 8px;
}
.world-bracket {
  display: flex;
  gap: 18px;
  min-width: max-content;
  align-items: stretch;
}
.round-column {
  width: 235px;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  gap: 12px;
}
.round-column > header {
  text-align: center;
  padding: 9px;
}
.round-column small {
  color: #7f95b6;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 8px;
}
.world-match {
  position: relative;
  padding: 10px;
  border-radius: 13px;
  background: rgba(5, 13, 29, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 9px 30px rgba(0, 0, 0, 0.25);
}
.world-match > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px;
}
.world-match > div + div {
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}
.world-match span {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
}
.world-match.upset {
  border-color: rgba(255, 196, 70, 0.5);
  box-shadow: 0 0 24px rgba(255, 196, 70, 0.14);
}
.world-match > svg {
  position: absolute;
  right: -6px;
  top: -6px;
  color: #ffc857;
}
.match-line {
  display: flex;
  align-items: center;
  gap: 8px;
}
.match-line em {
  color: #7188a9;
}
.match-line svg {
  color: #ffc857;
}
.honour-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
.award-list {
  display: grid;
  gap: 9px;
}
.award-list > div {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
}
.award-list > div > span {
  font-size: 27px;
}
.award-list small {
  display: block;
  color: #8fa4c4;
  margin-top: 4px;
}
.award-list strong {
  color: #ffe27c;
}
.progression-list{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin-top:14px}.progression-list>div{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;font-size:9px}.progression-list span{color:var(--muted)}.progression-list b{color:#ffe16e}
@media (max-width: 1050px) {
  .groups-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .country-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 760px) {
  .world-cup-shell {
    padding: 13px;
    border-radius: 18px;
  }
  .world-cup-hero {
    grid-template-columns: auto 1fr;
  }
  .world-cup-trophy {
    grid-column: 1/-1;
    text-align: left;
  }
  .overview-grid,
  .honour-grid {
    grid-template-columns: 1fr;
  }
  .entries-card {
    grid-column: auto;
  }
  .groups-grid {
    grid-template-columns: 1fr;
  }
  .country-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .section-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
@media (max-width: 480px) {
  .country-grid {
    grid-template-columns: 1fr;
  }
  .orb {
    width: 62px;
    height: 62px;
  }
  .hero-copy h1 {
    font-size: 30px;
  }
}
</style>
