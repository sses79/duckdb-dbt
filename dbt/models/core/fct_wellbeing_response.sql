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
