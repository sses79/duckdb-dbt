with full_history as (
    select * exclude (rn)
    from (
        select *,
            row_number() over (
                partition by document_id
                order by source_version desc, source_updated_at desc, event_id desc
            ) as rn
        from {{ ref('stg_wellbeing_submission_changes') }}
    )
    where rn = 1
),

latest as (
    select *
    from {{ ref('int_wellbeing_submission_latest') }}
),

missing_from_latest as (
    select * from full_history
    except
    select * from latest
),

extra_in_latest as (
    select * from latest
    except
    select * from full_history
)

select * from missing_from_latest
union all
select * from extra_in_latest
