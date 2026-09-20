with replay as (
    select event_id
    from {{ source('raw', 'wellbeing_submission_events') }}
    where batch_id = 'batch_m2_replay_late_older'
    limit 1
)

select 1
where exists (select 1 from replay)
and (
    (
        select count(*)
        from {{ source('raw', 'wellbeing_submission_events') }}
        where event_id = (select event_id from replay)
    ) < 2
    or (
        select count(distinct batch_id)
        from {{ source('raw', 'wellbeing_submission_events') }}
        where event_id = (select event_id from replay)
    ) < 2
    or (
        select count(*)
        from {{ ref('stg_wellbeing_submission_changes') }}
        where event_id = (select event_id from replay)
    ) <> 1
)
