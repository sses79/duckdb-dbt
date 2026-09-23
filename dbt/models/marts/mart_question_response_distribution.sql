with fact_rows as (
    select
        f.trust_id,
        f.school_id,
        f.school_classification,
        f.survey_period,
        f.question_code,
        f.answer_label
    from {{ ref('fct_wellbeing_response') }} as f
    where f.answer_label is not null
),

class_map as (
    select
        c.trust_id,
        c.school_id,
        c.survey_period,
        case
            when count(distinct c.school_classification) = 1 then min(c.school_classification)
            else 'Mixed source classifications'
        end as school_classification
    from {{ ref('fct_wellbeing_response') }} as c
    group by
        c.trust_id,
        c.school_id,
        c.survey_period
),

label_totals as (
    select
        l.trust_id,
        l.school_id,
        l.survey_period,
        l.question_code,
        l.answer_label,
        count(*) as response_count
    from fact_rows as l
    group by
        l.trust_id,
        l.school_id,
        l.survey_period,
        l.question_code,
        l.answer_label
),

question_totals as (
    select
        q.trust_id,
        q.school_id,
        q.survey_period,
        q.question_code,
        count(*) as answered_response_count
    from fact_rows as q
    group by
        q.trust_id,
        q.school_id,
        q.survey_period,
        q.question_code
),

answer_cat as (
    select
        a.question_code,
        a.answer_label,
        a.answer_order
    from {{ ref('indicator_answer_catalog') }} as a
    group by
        a.question_code,
        a.answer_label,
        a.answer_order
),

ind_cat as (
    select
        i.question_code,
        i.indicator_label,
        i.category_code,
        i.category_label
    from {{ ref('indicator_catalog') }} as i
    group by
        i.question_code,
        i.indicator_label,
        i.category_code,
        i.category_label
)

select
    lt.trust_id,
    lt.school_id,
    cm.school_classification,
    lt.survey_period,
    lt.question_code,
    ic.indicator_label,
    ic.category_code,
    ic.category_label,
    lt.answer_label,
    ac.answer_order,
    qt.answered_response_count,
    qt.answered_response_count < 10 as is_suppressed,
    case
        when qt.answered_response_count < 10 then null
        else lt.response_count
    end as response_count,
    case
        when qt.answered_response_count < 10 then null
        else round(lt.response_count / qt.answered_response_count, 4)
    end as response_rate
from label_totals as lt
join question_totals as qt
    on lt.trust_id = qt.trust_id
    and lt.school_id = qt.school_id
    and lt.survey_period = qt.survey_period
    and lt.question_code = qt.question_code
join class_map as cm
    on lt.trust_id = cm.trust_id
    and lt.school_id = cm.school_id
    and lt.survey_period = cm.survey_period
join answer_cat as ac
    on lt.question_code = ac.question_code
    and lt.answer_label = ac.answer_label
join ind_cat as ic
    on lt.question_code = ic.question_code
