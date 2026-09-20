{{
    config(
        materialized='incremental',
        unique_key=['document_id', 'question_code'],
        incremental_strategy='delete+insert',
        post_hook="
            delete from {{ this }}
            where not exists (
                select 1
                from {{ ref('int_wellbeing_answers') }} as b
                where b.document_id = {{ this }}.document_id
                  and b.question_code = {{ this }}.question_code
            )
        "
    )
}}
select
    a.document_id,
    a.trust_id,
    a.school_id,
    a.school_classification,
    a.year_group,
    a.survey_period,
    a.question_code,
    q.category,
    a.answer_label,
    cat.answer_order,
    a.answer_label is not null as is_answered,
    coalesce(cat.is_adverse, false) as is_adverse
from {{ ref('int_wellbeing_answers') }} as a
join (
    select distinct
        question_code,
        category
    from {{ ref('indicator_answer_catalog') }}
) as q
    on a.question_code = q.question_code
left join {{ ref('indicator_answer_catalog') }} as cat
    on a.question_code = cat.question_code
    and a.answer_label = cat.answer_label
{% if is_incremental() %}
where not exists (
    select 1
    from {{ this }} as t
    where t.document_id = a.document_id
      and t.question_code = a.question_code
      and t.trust_id is not distinct from a.trust_id
      and t.school_id is not distinct from a.school_id
      and t.school_classification is not distinct from a.school_classification
      and t.year_group is not distinct from a.year_group
      and t.survey_period is not distinct from a.survey_period
      and t.answer_label is not distinct from a.answer_label
)
{% endif %}
