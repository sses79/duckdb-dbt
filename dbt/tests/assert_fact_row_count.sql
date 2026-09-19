select 1
where (
    select count(*)
    from {{ ref('fct_wellbeing_response') }}
) <> (
    select count(*)
    from {{ ref('int_wellbeing_submission_current') }}
) * (
    select count(distinct question_code)
    from {{ ref('indicator_answer_catalog') }}
)
