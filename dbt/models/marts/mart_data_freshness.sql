select
    trust_id,
    max(loaded_at) as last_loaded_at,
    max(source_updated_at) as latest_source_updated_at,
    count(*) as logical_event_count
from {{ ref('stg_wellbeing_submission_changes') }}
where trust_id is not null
group by trust_id
