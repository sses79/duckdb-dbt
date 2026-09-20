{{ config(
    materialized='incremental',
    unique_key='document_id',
    incremental_strategy='delete+insert',
    on_schema_change='append_new_columns'
) }}

with incoming_changes as (
    select *
    from {{ ref('stg_wellbeing_submission_changes') }}
    {% if is_incremental() %}
    where event_id not in (select event_id from {{ this }})
    {% endif %}
),

candidate_changes as (
    select * from incoming_changes
    {% if is_incremental() %}
    union all
    select * from {{ this }}
    where document_id in (select document_id from incoming_changes)
    {% endif %}
),

ranked as (
    select *,
        row_number() over (
            partition by document_id
            order by source_version desc, source_updated_at desc, event_id desc
        ) as rn
    from candidate_changes
)

select * exclude (rn)
from ranked
where rn = 1
