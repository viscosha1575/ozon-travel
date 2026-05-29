import { query } from "./db.js";

const GLOBAL_APP_SETTINGS_KEY = "global";

function mapProjectState(row = {}) {
  return {
    projectFinished: Boolean(row.project_finished),
    updatedAt: row.updated_at || null,
  };
}

export async function getProjectState(client = null) {
  const executor = client || { query };
  const result = await executor.query(
    `
      SELECT project_finished, updated_at
      FROM app_runtime_settings
      WHERE settings_key = $1
      LIMIT 1
    `,
    [GLOBAL_APP_SETTINGS_KEY],
  );

  if (!result.rows.length) {
    return {
      projectFinished: false,
      updatedAt: null,
    };
  }

  return mapProjectState(result.rows[0]);
}

export async function setProjectFinished(projectFinished, client = null) {
  const executor = client || { query };
  const result = await executor.query(
    `
      INSERT INTO app_runtime_settings (
        settings_key,
        project_finished,
        updated_at
      )
      VALUES ($1, $2, NOW())
      ON CONFLICT (settings_key)
      DO UPDATE SET
        project_finished = EXCLUDED.project_finished,
        updated_at = NOW()
      RETURNING project_finished, updated_at
    `,
    [GLOBAL_APP_SETTINGS_KEY, Boolean(projectFinished)],
  );

  return mapProjectState(result.rows[0]);
}

export async function toggleProjectFinished(client = null) {
  const currentState = await getProjectState(client);
  return setProjectFinished(!currentState.projectFinished, client);
}
