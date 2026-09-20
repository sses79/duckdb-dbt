select 1
where (
    select count(*)
    from {{ ref('stg_wellbeing_submission_changes') }}
) <> (
    select count(distinct event_id)
    from {{ source('raw', 'wellbeing_submission_events') }}
)
or exists (
    select 1
    from {{ ref('stg_wellbeing_submission_changes') }}
    group by event_id
    having count(*) > 1
)
or exists (
    select event_id
    from {{ source('raw', 'wellbeing_submission_events') }}
    except
    select event_id
    from {{ ref('stg_wellbeing_submission_changes') }}
)
