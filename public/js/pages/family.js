// ============================================================
//  家族・見守りページ ロジック
// ============================================================

if (!requireLoginOrRedirect()) {
  throw new Error('未ログイン');
}

renderBottomNav('family');

const profile = Session.profile();
const isPatient = profile?.role === 'patient';

if (isPatient) {
  document.getElementById('page-title').textContent = '家族を招待';
  document.getElementById('patient-section').style.display = '';
  initPatientSection();
} else {
  document.getElementById('page-title').textContent = '見守り設定';
  document.getElementById('caregiver-section').style.display = '';
  initCaregiverSection();
}

// ---- 患者側: 招待コード表示・メンバー一覧 ----
async function initPatientSection() {
  try {
    const { ownedGroups } = await Api.listCareGroups();
    let group = ownedGroups?.[0];

    if (!group) {
      document.getElementById('invite-code-box').textContent = 'まだグループがありません';
      document.getElementById('create-group-btn').style.display = '';
      document.getElementById('create-group-btn').addEventListener('click', async () => {
        try {
          const { group: newGroup } = await Api.createCareGroup({ name: `${profile.name}さんの見守りグループ` });
          showToast('見守りグループを作成しました。', 'success');
          renderInviteCode(newGroup);
          loadMembers(newGroup.id);
        } catch (err) {
          handleApiError(err, 'グループの作成に失敗しました。');
        }
      });
      document.getElementById('member-list').innerHTML = '<p class="text-muted">グループ作成後に表示されます。</p>';
      return;
    }

    renderInviteCode(group);
    loadMembers(group.id);
  } catch (err) {
    handleApiError(err, '情報の取得に失敗しました。');
  }
}

function renderInviteCode(group) {
  document.getElementById('invite-code-box').textContent = group.invite_code;
}

async function loadMembers(groupId) {
  const container = document.getElementById('member-list');
  try {
    const { members } = await Api.listGroupMembers(groupId);
    if (!members || members.length === 0) {
      container.innerHTML = '<p class="text-muted">まだ参加しているご家族がいません。</p>';
      return;
    }
    container.innerHTML = members
      .map((m) => {
        const name = m.profiles?.name || '名前未設定';
        const initial = name.charAt(0);
        return `
          <div class="member-card">
            <div class="member-avatar">${initial}</div>
            <div>
              <strong>${name}</strong>
              <p class="text-sm text-muted" style="margin:0">${m.relation || '続柄未設定'} ・ 映像閲覧：${m.can_view_video ? '可' : '不可'}</p>
            </div>
          </div>`;
      })
      .join('');
  } catch (err) {
    container.innerHTML = '<p class="text-muted">読み込みに失敗しました。</p>';
  }
}

// ---- 介護者側: 招待コード参加・見守り対象一覧 ----
function initCaregiverSection() {
  loadWatchedList();

  document.getElementById('join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('invite-code-input').value.trim();
    if (!code) return;

    try {
      await Api.joinCareGroup({ invite_code: code, relation: '', can_view_video: true });
      showToast('参加しました。', 'success');
      document.getElementById('invite-code-input').value = '';
      loadWatchedList();
    } catch (err) {
      handleApiError(err, '参加に失敗しました。コードをご確認ください。');
    }
  });
}

async function loadWatchedList() {
  const container = document.getElementById('watched-list');
  try {
    const { memberGroups } = await Api.listCareGroups();
    if (!memberGroups || memberGroups.length === 0) {
      container.innerHTML = '<p class="text-muted">まだ見守り対象がいません。招待コードを入力してください。</p>';
      return;
    }
    container.innerHTML = memberGroups
      .map(
        (g) => `
        <div class="member-card">
          <div class="member-avatar">${(g.name || '見').charAt(0)}</div>
          <div>
            <strong>${g.name}</strong>
            <p class="text-sm text-muted" style="margin:0">「ホーム」タブから服薬状況を確認できます</p>
          </div>
        </div>`
      )
      .join('');
  } catch (err) {
    container.innerHTML = '<p class="text-muted">読み込みに失敗しました。</p>';
  }
}
